# Milestone 1 verification

Verified locally on 2026-09-19 with Windows, Node 24.19.0, and workspace-local npm 12.0.2.

| Check                                       | Result                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                         | Passed                                                                                                    |
| `npm run lint`                              | Passed                                                                                                    |
| `npm test`                                  | 14 integration cases passed                                                                               |
| `npm run build`                             | Passed                                                                                                    |
| `npm run format:check`                      | Passed before this verification note was added; note checked separately                                   |
| Source entry point: `node src/server.ts`    | Separate process accepted a native Node WebSocket client; welcome, echo, and normal client close verified |
| Compiled entry point: `node dist/server.js` | Same smoke sequence passed                                                                                |
| Dependency installation audit               | Reported zero vulnerabilities at installation time                                                        |

Test clients use ephemeral TCP ports and real WebSocket connections. No browser UI, heartbeat, rooms, Docker build, or hosted CI run is claimed. The smoke harness terminated only its own child server processes after each exchange; OS signal handling was not independently verified on Windows.

Exact direct versions: ws 8.21.3, TypeScript 6.0.3, Node types 24.13.6, ws types 8.18.1, Vitest 5.0.1, ESLint 10.11.0, TypeScript ESLint 8.70.0, Prettier 3.9.8. The lockfile records transitive versions. TypeScript 7.0.2 was not selected because it conflicts with TypeScript ESLint's declared peer support.

## This workspace's npm setup

The machine's PATH has Node but no npm. Dependencies are installed, so you can start this delivery directly with `node src/server.ts` from the project folder. To use the downloaded workspace-local npm here:

```powershell
node ../../work/npm/package/bin/npm-cli.js run dev
node ../../work/npm/package/bin/npm-cli.js test
```

The `work/` helper is environment setup, not part of the repository deliverable. On a normal Node installation, use `npm ci` and the standard README commands.
