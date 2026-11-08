# @local/jira-mcp-plugin

Local DSH Host plugin **cộng một Jira MCP server local**, source nằm trong repo
**eso-harness** (`tools/dsh-plugins/jira`). Một plugin phục vụ **nhiều** repo: mỗi workspace tự xác
định Atlassian site + credential của nó, rồi plugin start server MCP **của chính repo này** cho
session đó. Không có package npm nào phải cài thêm.

| Mục | Giá trị |
|---|---|
| Loader row | `jira-mcp-plugin` |
| Loại | Host plugin (có code) **+ stdio MCP server** local, chỉ import `node:*` |
| Transport | stdio → `node src/server.mjs`, mỗi agent một process |
| Tên tool | 14 tool (`get_issue`, `search_issues`, `create_issue`, …) — xem bảng dưới |
| Credential | `ctx.credentials` → token inline trong MCP config của repo → biến môi trường |
| Tenant | `.dsh/jira.json` → `.cursor/mcp.json` → `.agents/mcp_config.json` → thư mục cha |
| Đo lường | selfcheck PASS 2026-11-08 trên Jira Cloud thật; 108 test offline PASS |

## Vì sao cần bản này

Một profile DSH phục vụ nhiều repo, và mỗi repo có thể trỏ tới một Atlassian site khác nhau với
token khác nhau. Một row tĩnh trong `cordis.patch.yml` không thể diễn đạt điều đó: **Loader compose
row một lần lúc boot**, trước khi có bất kỳ session hay working directory nào, và `!!js` eval trong
loader context nên không có cwd của session. Vì vậy quyết định tenant nằm trong code, chạy mỗi lần
`agent/created`.

Khác với bản `@local/jira-mcp-plugin` cũ trong `baplatform` (wrap `bunx -y @rokealvo/jira-mcp`),
bản này **tự viết MCP server**:

- **Không phụ thuộc npm**. Một host plugin import package Harness/`npx` có thể kéo bản sao thứ hai
  của singleton vào profile (ATF-OPS-001); file chỉ import `node:*` thì package manager không có gì
  để cài, nên lỗi đó không thể tái diễn.
- **Tool surface đi cùng plugin**, không lệ thuộc phiên bản package thứ ba.
- **Khởi động nhanh và ổn định**: `initialize` + `tools/list` mất **~62 ms** với server local
  (đo 2026-11-08), so với ~1–2 s của `bunx` khi cache nguội/ấm tùy máy.
- **Guard máy cho luật nguy hiểm nhất**: `transition_issue` từ chối target `Done/Closed` khi chưa
  được người duyệt — đây là kiểm tra trong server, không phải lời nhắc prompt. Ba quy ước còn lại
  (wiki markup thay vì Markdown, gọi `get_transitions` trước, story points trên leaf) là policy trong
  tool description + wire format, không phải guard cứng.

## Năm sự thật đo được, và code sinh ra từ chúng

### 1. Node bundled roots từ chối chain của Atlassian trên máy này

Đo trên host này (2026-11-08), cùng một token, cùng một site:

| Cách gọi | Kết quả |
|---|---|
| `fetch('https://thangs2net.atlassian.net/rest/api/2/myself')` (Node 26.7.0) | `fetch failed` / `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` |
| `tls.getCACertificates('bundled')` / `('system')` | **118** root / **0** root |
| `NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem node …` | HTTP **200** |
| `curl` (system CA) | HTTP **200** |

Vì vậy `src/jira-api.mjs` không tắt kiểm chứng: nó đọc **OS CA bundle**
(`/etc/ssl/cert.pem`, rồi các đường dẫn Linux phổ biến) và truyền qua option `ca` của
`node:https`. `JIRA_CA_FILE` override; chỉ `insecureTls: true`/`JIRA_TLS_INSECURE=1` mới tắt
verification, và không bao giờ được bật ngầm. Cùng lúc, `/etc/ssl/cert.pem` là thứ
`.cursor/mcp.json` đang thay thế bằng `NODE_TLS_REJECT_UNAUTHORIZED=0` — bản này làm chặt hơn, không
lỏng hơn.

### 2. `/rest/api/2/search` đã bị xoá (410) — search phải dùng `/rest/api/3/search/jql`

Đo 2026-11-08: `GET /rest/api/2/search?jql=…` → **410** kèm message "migrate to
/rest/api/3/search/jql". Endpoint mới là POST, trả `{ issues, nextPageToken, isLast }` và **không
có `total`** (khác API cũ). `search_issues` vì thế phân trang bằng `nextPageToken`, không hứa một
con số tổng, và cap `maxResults` ở 100.

### 3. `Done/Closed` là chữ ký của người, không phải của agent

Status thật của project ESO (đo 2026-11-08): `Defered`, `To Do`, `In Progress`,
`Human In Review`, `Done`, `Closed`. Theo `AGENTS.md` (SLP), chỉ người ký `Done`. Server chặn
transition có target `statusCategory.key === 'done'` và trả lỗi đọc được, trừ khi caller truyền
`allowDone: true` (**chỉ khi operator đã yêu cầu rõ**). Đây là guard ở tầng tool, không phải lời
nhắc trong prompt.

### 4. Jira Cloud v2 nhận wiki markup, không phải Markdown/ADF

Repo này viết ticket bằng Jira wiki markup (standard 07 §7: `*bold*`, `{{code}}`, `h3.`, `* `).
`/rest/api/2/issue` nhận `description`/`comment.body` là string wiki markup, nên server gửi đúng
thứ đó và nói rõ trong description của tool. Gửi Markdown thì Jira trả 201 và ticket hiện nguyên dấu
— sai im lặng ở cả hai đầu.

### 5. Config hỏng là điểm dừng, không phải điểm bỏ qua

Nếu `.dsh/jira.json` (hoặc `.cursor/mcp.json` / `.agents/mcp_config.json`) tồn tại nhưng không parse
được, plugin **không** đi tiếp lên thư mục cha: làm vậy sẽ mượn tenant của repo khác. Nó log đường
dẫn + lỗi và không mount tool. `selfcheck` FAIL cùng lý do.

## Khai báo Jira cho một repo

Thứ tự tìm, gặp cái đầu tiên là dừng — xét trên working directory của agent rồi ngược lên tối đa 6
cấp cha (monorepo root phục vụ các package con):

**1. `<repo>/.dsh/jira.json`** — commit được, không chứa secret:

```json
{
  "site": "https://thangs2net.atlassian.net",
  "email": "thangs2.net@gmail.com",
  "credential": "JIRA_TOKEN_THANGS2NET",
  "projectKey": "ESO"
}
```

`credential` là **tên** key trong DSH credential store, **không phải** token. Bỏ trống thì tự suy ra
`JIRA_TOKEN_<HOST>` (`thangs2net.atlassian.net` → `JIRA_TOKEN_THANGS2NET`). Field nhận thêm:
`baseUrl`/`url`/`siteUrl` cho endpoint, `token`/`apiToken` cho deployment local (đừng commit),
`projectKey`/`project`, và `env` cho các biến `JIRA_*` **không** thuộc nhóm do plugin tự quyết
(`JIRA_MAX_RESULTS`, `JIRA_TIMEOUT_MS`, …). Các khoá `JIRA_BASE_URL`, `JIRA_USER_EMAIL`,
`JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`, `JIRA_CA_FILE`, `JIRA_TLS_INSECURE` bị bỏ qua — site và
credential không thể bị repo ghi đè.

**2. `<repo>/.cursor/mcp.json`** — entry tên `jira` (hoặc entry đầu tiên có `JIRA_BASE_URL`/
`JIRA_URL`). `command`/`args` trong config của repo **bị bỏ qua có chủ đích**: plugin start server
của chính nó, để một repo không thể biến session agent thành process tùy ý.

**3. `<repo>/.agents/mcp_config.json`** — cùng shape `mcpServers` cho Antigravity.

**4. Không có config** → **không đăng ký gì**. Plugin không spawn process, không làm chậm repo mà
nó không được cấu hình. Sự bất đối xứng này là tính năng: mở repo lạ mà vẫn thấy tool Jira thì
plugin đang đọc sai chỗ.

## Token nằm ở đâu

Ưu tiên từ trên xuống:

1. **DSH credential store** — `$DSH_HOME/.credentials.yaml`, owner-only, resolve qua
   `ctx.credentials.resolve(ref)`.
2. **Token inline trong config của repo** — `env.JIRA_API_TOKEN` ở `.cursor/mcp.json`; chỉ nên có
   ở file đã gitignore. Plugin không copy nó đi đâu.
3. **Biến môi trường** — `JIRA_TOKEN_<HOST>` (ví dụ `JIRA_TOKEN_THANGS2NET`). Riêng
   `JIRA_API_TOKEN` ambient **không** được gửi tới site do repo chọn trừ khi row bật
   `trustAmbientToken: true` — xem mục mô hình tin cậy bên dưới.
4. **Không có token** → không mount tool, log tên credential mong đợi. Đây là lỗi cấu hình, nhưng
   **không** làm throw: `agent/created` throw sẽ giết mọi session trong repo đó.

## Mô hình tin cậy: config repo là **untrusted**

Repo config quyết định *site nào*, nhưng không được phép rút credential của profile ra khỏi site mà
nó gắn với. Không có ranh giới đó, một file `.dsh/jira.json` commit vào repo lạ
(`site: https://attacker.example`, `credential: JIRA_TOKEN_THANGS2NET`) sẽ khiến plugin gửi token
thật của profile tới host do repo chọn ngay ở bước probe — trước khi model có bất kỳ quyết định nào.

Ba luật, tất cả đều mặc định an toàn và chỉ nới được từ **row config của profile** (không phải từ
repo):

| Luật | Mặc định | Nới bằng row config khi operator chấp nhận |
|---|---|---|
| Chỉ resolve credential **gắn với site**: `JIRA_TOKEN_<HOST>`; ref repo xin phải thuộc `JIRA_TOKEN_*` | áp dụng | `trustRepoCredentialRef: true` (dùng ref repo xin) |
| Không gửi `JIRA_API_TOKEN` ambient tới site do repo chọn | áp dụng | `trustAmbientToken: true` |
| Token chỉ đi qua HTTPS, trừ loopback | áp dụng | `allowInsecureSite: true` |

Repo vẫn có thể dùng token **của chính nó** (inline trong `.cursor/mcp.json`) với site của nó —
đó không phải secret của profile. Nhưng nó không thể map một credential khác của profile sang site
khác, và không thể đọc env var tùy ý (chỉ biến tên `JIRA_TOKEN_<HOST>`).

`selfcheck` áp dụng cùng luật; operator chạy tay có thể override bằng
`JIRA_TRUST_REPO_CREDENTIAL_REF=1`, `JIRA_ALLOW_INSECURE_SITE=1` và mặc định được dùng ambient
token (có in cảnh báo).

Đo 2026-11-08: profile `desktop` resolve token qua credential store; profile `headless` của DSH
**disable** `dsh-credentials-local` (thấy trong `--dump-config`), nên ở headless token đến từ config
inline hoặc env — selfcheck đọc thẳng file credential store nên kiểm tra được cả hai đường.

## 14 tool

| Tool | Việc | Ghi chú |
|---|---|---|
| `get_myself` | user + site hiện tại | probe/kiểm tra 401 |
| `get_issue` | đọc 1 issue + description + comments + links + subtasks | gọi trước khi sửa/transition |
| `search_issues` | JQL qua `/rest/api/3/search/jql` | cap 100, phân trang `nextPageToken` |
| `get_transitions` | các transition được phép | bắt buộc trước `transition_issue` |
| `get_projects` | project key/name/id | xác nhận project trước khi tạo |
| `get_project_issue_types` | issue type creatable | tránh đoán tên type |
| `get_fields` | id field Story Points/Sprint + tìm custom field | default đo được: `customfield_10016`, `customfield_10020` |
| `get_boards` / `get_sprints` | board + sprint active/future | sprint id cho create/update |
| `create_issue` | tạo 1 issue | có `dryRun`; parent bắt buộc với Subtask |
| `update_issue` | sửa field | `null` để clear points/sprint; chỉ field được truyền mới ghi |
| `add_comment` | comment wiki markup | |
| `transition_issue` | chuyển workflow | chặn `Done/Closed` trừ `allowDone: true` |
| `link_issues` | link 2 issue | `Blocks`: inward=blocker, outward=blocked (đo 2026-11-03) |

Thời gian đo 2026-11-08 (mạng thật): probe `myself` ~**730 ms**, `initialize`+`tools/list` ~**62 ms**,
một `search_issues` (1 issue) ~**680 ms**.

## Cài đặt

**Settings → Plugins** trong DSH → install a bundle → trỏ tới:

```
/Users/thangs2net/Workspaces/eso-harness/tools/dsh-plugins/jira
```

Hoặc sửa profile như máy này (đã áp dụng 2026-11-08):

1. `~/.dsh/profiles/<profile>/package.json`:
   `"@local/jira-mcp-plugin": "link:/Users/thangs2net/Workspaces/eso-harness/tools/dsh-plugins/jira"`,
   và thêm `"@local/jira-mcp-plugin"` vào `dsh.profile.bundles`.
2. `dsh plugin --profile <profile> install` (pnpm link, ~1.5 s).
3. Row `jira-mcp-plugin` do bundle tự chèn từ `cordis.patch.yml`. Muốn override config thì thêm row
   cùng `id` vào `~/.dsh/profiles/<profile>/cordis.patch.yml`.
4. **Khởi động lại DSH** — Host plugin không HMR.

Lưu ý: profile `desktop` do Electron quản lý, `dsh --profile desktop --dump-config` trả
`profile "desktop" is managed exclusively by the Electron application` (đo 2026-11-08). Vì vậy
việc kiểm tra composition được làm trên một profile headless nháp:

```bash
dsh --profile jira-e2e --from-default-profile headless --dump-config   # tạo profile nháp
dsh --profile jira-e2e --patch /tmp/jira-row.yml --dump-config | grep -A 8 jira-mcp-plugin
```

## Kiểm tra

**Không cần cài gì** — chạy đúng code mà plugin chạy lúc `agent/created`:

```bash
node tools/dsh-plugins/jira/src/selfcheck.mjs /Users/thangs2net/Workspaces/eso-harness ESO-400
```

Kết quả đúng (đo 2026-11-08):

```
workspace:  /Users/thangs2net/Workspaces/eso-harness
site:       https://thangs2net.atlassian.net
email:      thangs2.net@gmail.com
project:    (not configured — pass projectKey to tools)
config:     /Users/thangs2net/Workspaces/eso-harness/.cursor/mcp.json
credential: JIRA_TOKEN_THANGS2NET
token:      resolved from credentials:JIRA_TOKEN_THANGS2NET(.../.credentials.yaml) (not printed)
tls:        ca /etc/ssl/cert.pem
myself:     ok — le tat thang <thangs2.net@gmail.com> (…)
server:     jira 1.0.0
protocol:   2025-06-18
tools:      14 — get_myself, get_issue, search_issues, …
get_myself: site: https://thangs2net.atlassian.net user: … accountId: …
get_issue:  ESO-400 — F-24 — ESO native memory ... | status: To Do (new) · type: Epic · …
PASS: site, token, TLS, handshake, 14 tools and a read-only Jira call all work.
```

Nếu repo chưa cấu hình, selfcheck FAIL kèm hướng dẫn thêm `.dsh/jira.json` — đúng thiết kế.

**Test offline** — 108 test, không cần mạng, không cần Jira:

```bash
cd tools/dsh-plugins/jira && node --test test/*.test.mjs
# ℹ tests 108 · pass 108 · fail 0  (~3.3 s, đo 2026-11-08)
```

Bộ test phủ: resolution (4 dialect + precedence + parent walk + broken config + credential/env
fallback + **credential-ref binding / hostname-port binding / ambient-token / secure-site**), stdio client (handshake,
JSON-RPC error, timeout, banner, missing binary, cancel), REST client (auth header,
401/410/non-JSON, absolute deadline, abort → CANCELLED, pagination, field ids, CA), 26 test tool
(`get_issue` format, dryRun, payload create/update, Done guard, link direction, 401,
**notifications/cancelled dừng cả read và write**…), plugin lifecycle (no config → 0 tool/0
process, probe fail, thiếu token/email, insecure site, cwd không resolve, bootstrap agent sống,
dispose-during-install, **unload-during-bootstrap không leak process**, duplicate event, unload,
prefix, env caFile/insecureTls).

**End-to-end thật** (đo 2026-11-08): profile headless nháp `jira-e2e` + bundle này + model thật,
prompt "dùng tool Jira get_issue đọc ESO-400" → model gọi tool và trả đúng
`ESO-400 — F-24 — ESO native memory ... / status: To Do (new)`. Debug log của plugin xác nhận
`install agent/created` → `tenant=https://thangs2net.atlassian.net` → `probe=ok`.

**Chẩn đoán "không thấy tool"**: đặt `JIRA_PLUGIN_DEBUG=1` (và
`JIRA_PLUGIN_DEBUG_FILE=/tmp/jira.log`) để plugin ghi lý do ra stderr/file:

```
[jira-mcp-plugin] start session=… cwd=/path/to/repo
[jira-mcp-plugin] tenant=https://… (…)      | tenant=none  → repo chưa cấu hình
[jira-mcp-plugin] probe=ok                  | probe=fail(…) → token/site/TLS
```

## Dùng server ngoài DSH (Cursor / Antigravity / bất kỳ MCP client)

`src/server.mjs` là MCP server stdio độc lập, không cần DSH. Trỏ một MCP client khác vào nó:

```json
{
  "mcpServers": {
    "jira-local": {
      "command": "node",
      "args": ["/Users/thangs2net/Workspaces/eso-harness/tools/dsh-plugins/jira/src/server.mjs"],
      "env": {
        "JIRA_BASE_URL": "https://thangs2net.atlassian.net",
        "JIRA_USER_EMAIL": "thangs2.net@gmail.com",
        "JIRA_API_TOKEN": "<token>",
        "JIRA_PROJECT_KEY": "ESO"
      }
    }
  }
}
```

(`jira-mcp-server` cũng là `bin` của package khi được cài bằng package manager, nhưng đường dẫn
tuyệt đối tới `src/server.mjs` là cách ổn định nhất với plugin link.) Token vẫn chỉ đọc từ env —
server không đọc `.dsh`/`.cursor` config, vì phần resolution đó thuộc plugin.

## Cấu hình row

| Key | Mặc định | Ý nghĩa |
|---|---|---|
| `failOnStartupError` | `false` | `true` = log khởi động thất bại bằng `logger.error` thay vì `logger.info`. **Không** throw (throw = giết agent registration). |
| `timeoutMs` | `120000` | Trần mỗi tool call; transport timeout thấp hơn để lỗi thành tool result đọc được. |
| `probeTimeoutMs` | `5000` | Trần probe `GET /rest/api/2/myself` mỗi agent. |
| `caFile` | `null` | PEM bundle để trust; `null` = tự tìm OS bundle (`/etc/ssl/cert.pem`, …). |
| `insecureTls` | `false` | Tắt kiểm chứng TLS cho server con. Chỉ khi chấp nhận rủi ro. |
| `serverCommand` / `serverArgs` | — | Mặc định chạy `src/server.mjs` bằng Node của host; đổi được sang MCP server stdio khác. |
| `toolPrefix` | `''` | Prefix tên tool (tránh đụng tên nếu profile có nhiều MCP). |
| `trustRepoCredentialRef` | `false` | Cho repo dùng ref `JIRA_TOKEN_*` khác ref gắn với site. Chỉ bật khi tin repo. |
| `trustAmbientToken` | `false` | Cho phép dùng `JIRA_API_TOKEN` ambient cho site do repo chọn. Chỉ bật khi tin repo. |
| `allowInsecureSite` | `false` | Cho phép site `http://` non-loopback (token đi plaintext). Chỉ bật khi chấp nhận. |
| `default` | — | Tenant dự phòng toàn profile khi repo không có config. |

## Vòng đời agent — chỗ dễ sai nhất

`agent/created` và `agent/disposed` **không** truyền Agent làm tham số. `dsh-agent` phát
`ctx.serial(carrier, 'agent/created', { agent, … })`, và `dispatch()` của Cordis cắt `this`/tên
event trước khi gọi listener — nên listener nhận **payload**. Đọc `agent.session` trên payload ra
`undefined` → `workingDirectory.get(undefined)` throw → bị nuốt → **0 tool, 0 dòng log**. Đây đúng
là lỗi bản Jira cũ mắc phải (sửa 2026-10-29); test `plugin.test.mjs` phát đúng payload thật và có
test riêng cho payload không phải agent.

Các tình huống khác được xử lý thay vì bỏ qua:

| Tình huống | Hành vi |
|---|---|
| Agent đã sống trước khi plugin activate (HMR/bật qua plugin-manager) | `ctx.agents.list()` seed, không chặn activation |
| Agent bị dispose trong lúc handshake đang chạy | process bị đóng ngay, không lọt vào Map |
| Plugin unload | mọi process con bị SIGTERM, tool bị dispose; install đang chạy tự đóng child thay vì ghi vào map đã clear |
| `agent/created` trùng | `installing`/`sessions` chặn, không spawn process thứ hai |
| Probe/token/handshake fail | 0 tool + 1 dòng log nêu tenant và lý do |
| Call lỗi / server chết giữa session | trả `{ text, isError: true }`; message của server vẫn tới model |

## Giới hạn đã biết

- **Mỗi agent một process MCP** (không phải mỗi repo). Mười session đồng thời trong cùng repo là
  mười process; mỗi cái nhẹ nhưng không chia sẻ. Đổi repo giữa session vẫn giữ tenant lúc khởi tạo.
- **Chỉ POSIX**: resolution đòi cwd tuyệt đối bắt đầu bằng `/`. Chưa hỗ trợ Windows.
- **Chỉ `tools`** — không MCP resources/prompts; tool list cố định 14.
- **Jira Cloud basic auth** (email + API token). Chưa hỗ trợ Bearer/PAT self-hosted, OAuth.
- **Site là origin** (`https://host`); chưa hỗ trợ Jira self-hosted có context path (`/jira`).
- **Wiki markup, không ADF**: description/comment là string v2. Nếu sau này chuyển sang
  `/rest/api/3` + ADF thì phải viết converter và sửa cả tool description.
- **`search_issues` không có `total`** (API mới không trả); đừng hứa con số tổng.
- **`get_fields` gọi `/rest/api/2/field` mỗi lần đổi points/sprint** — một request thêm, chấp nhận
  được vì hiếm; cache sẽ làm sai khi tenant đổi field.
- **Probe tốn một request mỗi agent** (~730 ms trên mạng thật); đổi lại là lỗi token/site hiện ra
  ngay thay vì 401 ở tool call đầu.
- **Huỷ tool call**: client gửi `notifications/cancelled`; server abort HTTP request tương ứng
  (đo: call chậm 3 s bị dừng dưới 1 s, write bị huỷ không tới fixture). Tuy vậy nếu request đã tới
  Jira và Jira xử lý xong trước khi abort, write vẫn có thể đã xảy ra — kiểm tra lại trước khi retry.
- **`workingDirectory` của session** là nguồn chọn tenant; nếu host không resolve được cwd, plugin
  log lý do và không mount tool (không im lặng).
- **Host plugin không HMR**: sau khi sửa profile phải restart DSH.
- **Token nằm trong `.cursor/mcp.json` của repo này là file gitignored/untracked** (đo 2026-11-08:
  `git ls-files .cursor/mcp.json` rỗng) — vẫn nên chuyển hẳn sang `~/.dsh/.credentials.yaml` để
  token không phụ thuộc một file local dễ copy nhầm.

## Khác biệt so với `@local/agentmemory-mcp-plugin`

| | AgentMemory | Jira (bản này) |
|---|---|---|
| MCP server | package npm `@agentmemory/mcp` (npx) | **local** `src/server.mjs` (node) |
| Probe | `GET /agentmemory/livez` + payload check | `GET /rest/api/2/myself` (auth thật) |
| Fallback khi server chết | shim có fallback store dùng chung → phải chặn | không có fallback; 0 tool + log |
| Credential | tuỳ chọn với loopback | **bắt buộc** (thiếu token = 0 tool) |
| Ghi dữ liệu | memory store | Jira thật — có `dryRun`, guard Done, payload tối thiểu |
