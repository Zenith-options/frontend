// Typed errors thrown by the Vault SDK so callers can narrow on `instanceof`.

export class VaultValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultValidationError";
  }
}

export class InvalidAddressError extends VaultValidationError {
  readonly address: string;
  constructor(address: string) {
    super(
      address.length === 0
        ? "Recipient address is required."
        : `"${address}" is not a valid Stellar address. Expected a 56-character G… address.`,
    );
    this.name = "InvalidAddressError";
    this.address = address;
  }
}
