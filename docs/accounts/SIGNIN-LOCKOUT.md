# Sign-in lock-out (B3)

Finding B3 of the 19 Nov full-stack test: anyone could lock any e-mail address out of signing in for an hour by sending about 15 wrong codes for it. No login was needed, and after the lock even the owner's right code was refused.

## What was wrong

`verify-code` counted wrong guesses against the address and against the open code, whoever sent them. Fifteen guesses from one connection filled the address budget; five used the code up. The owner then had no way in until the hour was over.

## What the sources say

- NIST SP 800-63B-4 (3.1.3): with a secret under 64 bits the verifier must limit failures, and issuing a new secret does not reset the failure count. So the budget has to live on the address, not on the code.
- OWASP Authentication Cheat Sheet and Forgot Password Cheat Sheet: tie the counter to the account, and do not let lock-out become a denial of service; keep recovery reachable.
- ASVS 6.6.2: bind the code to the request that generated it. Here that binding is the connection that asked for the code, not a cookie (see "Not done").

Pure per-IP counting would break the first rule: someone with many IPs would get a fresh budget on each. Pure per-address counting is the bug. So the budgets are layered.

## What it does now

Every attempt that runs is one row in `auth_attempts` (address, connection hash, whether that connection asked for the code), kept for an hour of effect and a day on disk. Before a code is compared, the attempt is reserved under a per-address lock, so parallel guesses cannot overshoot. Past a limit the attempt is refused with 429 `too_many_attempts` and `retryAfter` 3600, and it is not counted.

| Limit | Default | Who it stops | Setting |
|---|---|---|---|
| Per connection | 8 an hour | One connection guessing on one address | `AUTH_SOURCE_ATTEMPTS_PER_HOUR` |
| Shared pool | 24 an hour | Connections other than the one that asked for the code, together | `AUTH_ADDRESS_ATTEMPTS_PER_HOUR` |
| Ceiling | 40 an hour | Everyone together: the brute-force bound | `AUTH_ADDRESS_HARD_ATTEMPTS_PER_HOUR` |

- A guess from another connection never uses up the code. Only guesses from the connection that asked for it count against the code's five tries.
- The connection that asked for the code is outside the shared pool, so strangers filling the pool do not stop the owner on the connection they asked from.
- A successful sign-in clears the counters of the address.
- Hitting the ceiling is logged (`address_locked`, detail `hard`) and alerts the operator once an hour.

## The bound

At most 40 attempts an hour reach the comparison for one address, so a guess succeeds with probability at most 40 in 1,000,000 an hour (the old figure was 15). NIST allows up to 100 consecutive failures.

## What stays possible

- An attacker who controls enough connections can still lock an address: about three to use the shared pool, about five connections that also each ask for a code to reach the ceiling. It now costs coordination, and the operator is alerted at the ceiling. It no longer costs one request loop.
- An owner who verifies from a different connection than the one that asked (a phone switching from Wi-Fi to mobile data in the minute between request and verify) is counted in the shared pool. That only matters while strangers are filling it.

## Not done

Binding each code to a cookie set when it is requested would remove the remaining cases entirely. It needs the front end to send credentials on `request-code`, so it waits for the front-end developer.

## Operating it

New table `auth_attempts` by `auth_attempts.sql`; run the migrations on deploy. Events: `source_locked`, `address_locked` (the admin summary's `locked` counts both and `code_locked`).
