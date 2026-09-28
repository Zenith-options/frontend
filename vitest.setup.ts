import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// React Testing Library only auto-registers cleanup when Vitest's globals are
// enabled. They are not (tests import explicitly), so without this every test
// would render into the same document and `getByText` would match the previous
// test's tree.
afterEach(cleanup);
