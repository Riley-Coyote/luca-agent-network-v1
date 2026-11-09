import assert from "node:assert/strict";
import { test } from "node:test";
import { rustSignals, typescriptSignals } from "./state-machine-inventory.mjs";

test("inventory records owners and state shape without copying private initializers", () => {
  const result = typescriptSignals(`
    function Example() {
      const [loading, setLoading] = React.useState(false);
      const [phase, dispatch] = useReducer(reduce, "idle");
      const pendingEpoch = useRef(0);
      const snapshot = useSyncExternalStore(subscribe, read);
      const [secret] = useState("PRIVATE_INITIAL_VALUE");
    }
    type RequestState = { phase: "idle" } | { phase: "pending" };
  `);
  assert.deepEqual(result.parseErrors, []);
  assert.deepEqual(
    result.signals.map((item) => item.kind),
    [
      "state",
      "reducer",
      "lifecycle-ref",
      "external-store",
      "state",
      "state-union",
    ],
  );
  assert.equal(result.signals[0].owner, "Example");
  assert.equal(result.signals[0].boolean, true);
  assert.deepEqual(result.signals.at(-1).values, ["idle", "pending"]);
  assert.ok(!JSON.stringify(result).includes("PRIVATE_INITIAL_VALUE"));
});

test("inventory deliberately avoids treating unrelated methods as React hooks", () => {
  const result = typescriptSignals(
    `const x = other.useState(false); const work = () => { const [busy] = useState<boolean>(); };`,
  );
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].owner, "work");
  assert.equal(result.signals[0].boolean, true);
});

test("Rust inventory reports explicit lifecycle enums and implicit lifecycle flags", () => {
  assert.deepEqual(
    rustSignals(
      "pub enum DeliveryState {\n}\n paused: bool,\n is_running: AtomicBool,\npub enum Colour {\n}",
    ),
    [
      { line: 1, kind: "rust-state-enum", name: "DeliveryState" },
      { line: 4, kind: "rust-lifecycle-flag", name: "is_running" },
    ],
  );
});
