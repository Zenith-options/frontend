//! Vault LP incentive distributor: cumulative Merkle claims over a SEP-41 reward token.
//!
//! Off-chain, a job computes each depositor's cumulative reward per vault and
//! publishes a Merkle root. On-chain, this contract stores only the latest root
//! and the funding ledger; depositors claim by proving `(account, cumulative)`
//! against the root and receive `cumulative - already_claimed`.
//!
//! Leaf encoding (must match the off-chain generator and the frontend verifier):
//!   leaf = sha256(0x00 || account_strkey_utf8 || 0x00 || cumulative_u128_be)
//! Internal node (sorted pair, so proofs carry no direction bits):
//!   node = sha256(0x01 || min(a, b) || max(a, b))
//! A level with no sibling promotes its node unchanged; proofs simply omit it.
//!
//! Invariants:
//!   - Roots are published with strictly increasing epochs, so a funded epoch
//!     is never overwritten.
//!   - `total_allocated` never decreases and never exceeds total funding.
//!   - Only the latest root is claimable; cumulative amounts make a newer root
//!     supersede unclaimed amounts from older ones.
//!   - Total payouts never exceed the latest root's `total_allocated`.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Bytes,
    BytesN, Env, Vec,
};

/// Instance / persistent TTL policy, in ledgers (~5s per ledger).
const TTL_THRESHOLD: u32 = 17_280 * 30;
const TTL_EXTEND_TO: u32 = 17_280 * 60;

/// Length of a G... or C... strkey, the only address forms that can hold rewards.
const STRKEY_LEN: usize = 56;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Root {
    /// Publication epoch. Strictly increasing across `set_root` calls.
    pub epoch: u32,
    pub root: BytesN<32>,
    /// Sum of all leaf cumulatives in this root (base units of the reward token).
    pub total_allocated: i128,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Operator,
    Token,
    /// Ledger timestamp after which the admin may sweep unclaimed rewards.
    Expiry,
    /// Sum of all transfers into the contract by `fund`.
    Funded,
    /// Sum of all claim payouts.
    TotalClaimed,
    /// Latest published root.
    Root,
    /// Set once `sweep_unclaimed` runs; claims are closed afterwards.
    Swept,
    /// Cumulative amount already paid to an account (persistent).
    Claimed(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RewardsError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    InvalidAmount = 4,
    InvalidAddress = 5,
    EpochNotAdvancing = 6,
    AllocationDecreased = 7,
    AllocationExceedsFunding = 8,
    NoRoot = 9,
    InvalidProof = 10,
    NothingToClaim = 11,
    ExceedsAllocation = 12,
    InsufficientSurplus = 13,
    ProgramNotExpired = 14,
    Closed = 15,
}

#[contract]
pub struct ZenithRewardsDistributor;

#[contractimpl]
impl ZenithRewardsDistributor {
    /// One-time setup. `expiry` is the ledger timestamp after which unclaimed
    /// rewards may be swept by the admin.
    pub fn initialize(
        env: Env,
        admin: Address,
        operator: Address,
        token: Address,
        expiry: u64,
    ) -> Result<(), RewardsError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RewardsError::AlreadyInitialized);
        }
        admin.require_auth();

        let storage = env.storage().instance();
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Operator, &operator);
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::Expiry, &expiry);
        storage.set(&DataKey::Funded, &0_i128);
        storage.set(&DataKey::TotalClaimed, &0_i128);
        storage.set(&DataKey::Swept, &false);
        storage.extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Operator transfers reward tokens into the distributor. Each transfer is
    /// emitted as a `fund` event so the funding trail is auditable.
    pub fn fund(env: Env, from: Address, amount: i128) -> Result<(), RewardsError> {
        let operator = load::<Address>(&env, &DataKey::Operator)?;
        if amount <= 0 {
            return Err(RewardsError::InvalidAmount);
        }
        if from != operator {
            return Err(RewardsError::Unauthorized);
        }
        from.require_auth();

        let contract = env.current_contract_address();
        token::Client::new(&env, &load::<Address>(&env, &DataKey::Token)?)
            .transfer(&from, &contract, &amount);

        let funded = load::<i128>(&env, &DataKey::Funded)? + amount;
        env.storage().instance().set(&DataKey::Funded, &funded);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        env.events().publish((symbol_short!("fund"), from), amount);
        Ok(())
    }

    /// Publishes a new cumulative root. Operator only. Epochs must strictly
    /// increase, `total_allocated` must not decrease, and it must be covered by
    /// funding, so a generation run cannot overwrite a funded epoch or promise
    /// more than has been deposited.
    pub fn set_root(
        env: Env,
        caller: Address,
        epoch: u32,
        root: BytesN<32>,
        total_allocated: i128,
    ) -> Result<(), RewardsError> {
        require_role(&env, DataKey::Operator, &caller)?;
        if total_allocated < 0 {
            return Err(RewardsError::InvalidAmount);
        }
        if total_allocated > load::<i128>(&env, &DataKey::Funded)? {
            return Err(RewardsError::AllocationExceedsFunding);
        }

        let previous: Option<Root> = env.storage().instance().get(&DataKey::Root);
        if let Some(prev) = &previous {
            if epoch <= prev.epoch {
                return Err(RewardsError::EpochNotAdvancing);
            }
            if total_allocated < prev.total_allocated {
                return Err(RewardsError::AllocationDecreased);
            }
        }

        env.storage().instance().set(
            &DataKey::Root,
            &Root { epoch, root: root.clone(), total_allocated },
        );
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        env.events().publish((symbol_short!("root"), epoch), (root, total_allocated));
        Ok(())
    }

    /// Claims `cumulative - already_claimed` for `account`, proven against the
    /// latest root. Repeating a claim with the same cumulative pays nothing.
    pub fn claim(
        env: Env,
        account: Address,
        cumulative: i128,
        proof: Vec<BytesN<32>>,
    ) -> Result<i128, RewardsError> {
        ensure_open(&env)?;
        account.require_auth();
        if cumulative < 0 {
            return Err(RewardsError::InvalidAmount);
        }
        let latest: Root = env.storage().instance().get(&DataKey::Root).ok_or(RewardsError::NoRoot)?;

        let mut node = leaf_hash(&env, &account, cumulative)?;
        for sibling in proof.iter() {
            node = hash_pair(&env, &node, &sibling);
        }
        if node != latest.root {
            return Err(RewardsError::InvalidProof);
        }

        let claim_key = DataKey::Claimed(account.clone());
        let claimed: i128 = env.storage().persistent().get(&claim_key).unwrap_or(0);
        if cumulative <= claimed {
            return Err(RewardsError::NothingToClaim);
        }
        let payout = cumulative - claimed;

        let total_claimed = load::<i128>(&env, &DataKey::TotalClaimed)? + payout;
        if total_claimed > latest.total_allocated {
            return Err(RewardsError::ExceedsAllocation);
        }

        // Effects before the token transfer.
        env.storage().persistent().set(&claim_key, &cumulative);
        env.storage().persistent().extend_ttl(&claim_key, TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage().instance().set(&DataKey::TotalClaimed, &total_claimed);
        env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        token::Client::new(&env, &load::<Address>(&env, &DataKey::Token)?).transfer(
            &env.current_contract_address(),
            &account,
            &payout,
        );
        env.events().publish((symbol_short!("claim"), account), payout);
        Ok(payout)
    }

    /// Recovers funds that are not owed under the latest root (surplus funding,
    /// or a root that under-allocated). Admin only. Never touches owed amounts.
    pub fn recover_surplus(env: Env, caller: Address, to: Address, amount: i128) -> Result<(), RewardsError> {
        require_role(&env, DataKey::Admin, &caller)?;
        if amount <= 0 {
            return Err(RewardsError::InvalidAmount);
        }
        let surplus = surplus(&env)?;
        if amount > surplus {
            return Err(RewardsError::InsufficientSurplus);
        }
        transfer_out(&env, &to, amount)?;
        env.events().publish((symbol_short!("recover"), to), amount);
        Ok(())
    }

    /// Sweeps everything left in the contract, including owed-but-unclaimed
    /// amounts, once `expiry` has passed. Admin only. Closes further claims.
    pub fn sweep_unclaimed(env: Env, caller: Address, to: Address) -> Result<i128, RewardsError> {
        require_role(&env, DataKey::Admin, &caller)?;
        if env.ledger().timestamp() < load::<u64>(&env, &DataKey::Expiry)? {
            return Err(RewardsError::ProgramNotExpired);
        }
        let token = token::Client::new(&env, &load::<Address>(&env, &DataKey::Token)?);
        let balance = token.balance(&env.current_contract_address());
        env.storage().instance().set(&DataKey::Swept, &true);
        if balance > 0 {
            token.transfer(&env.current_contract_address(), &to, &balance);
        }
        env.events().publish((symbol_short!("sweep"), to), balance);
        Ok(balance)
    }

    // -----------------------------------------------------------------------
    // Read-only views
    // -----------------------------------------------------------------------

    pub fn get_root(env: Env) -> Option<Root> {
        env.storage().instance().get(&DataKey::Root)
    }

    /// Cumulative amount already paid to `account`.
    pub fn get_claimed(env: Env, account: Address) -> i128 {
        env.storage().persistent().get(&DataKey::Claimed(account)).unwrap_or(0)
    }

    pub fn get_funded(env: Env) -> Result<i128, RewardsError> {
        load(&env, &DataKey::Funded)
    }

    pub fn get_total_claimed(env: Env) -> Result<i128, RewardsError> {
        load(&env, &DataKey::TotalClaimed)
    }
}

fn load<T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(env: &Env, key: &DataKey) -> Result<T, RewardsError> {
    env.storage().instance().get(key).ok_or(RewardsError::NotInitialized)
}

fn require_role(env: &Env, role: DataKey, caller: &Address) -> Result<(), RewardsError> {
    if load::<Address>(env, &role)? != *caller {
        return Err(RewardsError::Unauthorized);
    }
    caller.require_auth();
    Ok(())
}

fn ensure_open(env: &Env) -> Result<(), RewardsError> {
    if load::<bool>(env, &DataKey::Swept)? {
        return Err(RewardsError::Closed);
    }
    Ok(())
}

/// Funded minus what the latest root still owes; never negative.
fn surplus(env: &Env) -> Result<i128, RewardsError> {
    let token = token::Client::new(env, &load::<Address>(env, &DataKey::Token)?);
    let balance = token.balance(&env.current_contract_address());
    let owed = match env.storage().instance().get::<_, Root>(&DataKey::Root) {
        Some(root) => root.total_allocated - load::<i128>(env, &DataKey::TotalClaimed)?,
        None => 0,
    };
    Ok((balance - owed).max(0))
}

fn transfer_out(env: &Env, to: &Address, amount: i128) -> Result<(), RewardsError> {
    token::Client::new(env, &load::<Address>(env, &DataKey::Token)?).transfer(
        &env.current_contract_address(),
        to,
        &amount,
    );
    Ok(())
}

fn leaf_hash(env: &Env, account: &Address, cumulative: i128) -> Result<BytesN<32>, RewardsError> {
    let strkey = account.to_string();
    if strkey.len() as usize != STRKEY_LEN {
        return Err(RewardsError::InvalidAddress);
    }
    let mut buf = [0u8; STRKEY_LEN];
    strkey.copy_into_slice(&mut buf);

    let mut preimage = Bytes::from_slice(env, &[0x00]);
    preimage.append(&Bytes::from_slice(env, &buf));
    preimage.append(&Bytes::from_slice(env, &[0x00]));
    preimage.append(&Bytes::from_slice(env, &cumulative.to_be_bytes()));
    Ok(env.crypto().sha256(&preimage).to_bytes())
}

fn hash_pair(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let (lo, hi) = if a.to_array() <= b.to_array() { (a, b) } else { (b, a) };
    let mut preimage = Bytes::from_slice(env, &[0x01]);
    preimage.append(&Bytes::from_slice(env, &lo.to_array()));
    preimage.append(&Bytes::from_slice(env, &hi.to_array()));
    env.crypto().sha256(&preimage).to_bytes()
}
