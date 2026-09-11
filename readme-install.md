# Cai Multiagents Chat va MCP

Huong dan nay dung cho VS Code desktop, uu tien Windows. Extension local khong
duoc publish len Marketplace. VSIX chi chua giao dien Chat; no khong chua Bun,
Codex, MCP server, API keys hoac lich su session.

## 1. Cai extension vao VS Code hien tai

Neu da co file `artifacts/multiagents-chat-0.1.2.vsix`:

1. Mo dung cua so VS Code va profile ban muon su dung.
2. Mo Extensions (`Ctrl+Shift+X`), menu `...`, chon **Install from VSIX...**.
3. Chon file VSIX. Neu VS Code hoi ve publisher local/unsigned, chi chap nhan
   khi ban tin cay nguon file. Khong tat kiem tra trust toan cuc.
4. Chon **Developer: Reload Window** neu extension chua hien ra. Reload co the
   ngat MCP dang chay; luu cong viec va chu dong xu ly doi worker truoc.
5. Mo Chat cuc bo, nhap `@multiagents`. Khong can F5 hoac Cloud Agent.

Co the cai bang CLI (khong publish):

```powershell
code --install-extension .\artifacts\multiagents-chat-0.1.2.vsix
code --list-extensions --show-versions
```

Danh sach phai co `multiagents-local.multiagents-chat@0.1.2`. Cai extension
khong dong nghia participant da duoc kich hoat thanh cong: thu `/status` o buoc 4.
Neu dung profile rieng, cai bang giao dien ngay trong profile do; CLI mac dinh
khong chung minh extension da bat o moi profile. Voi VS Code Insiders, dung
giao dien Insiders hoac CLI `code-insiders`.

## 2. Chuyen sang may khac

### Mang theo

- File VSIX va `readme-install.md`: du de cai giao dien Chat, khong can build lai.
- Source multiagents **co cac thay doi hien tai**, neu may dich chua co MCP.
  Clone mot commit cu khong chua code local/untracked thi se thieu tinh nang.
  Mang theo cac thu muc source: `adapters`, `cli`, `dashboard`, `orchestrator`,
  `shared`, `scripts`, `extensions`, `tests`, `docs`; cac file TypeScript o root,
  `package.json`, `bun.lock`, `tsconfig.json`, `setup-copilot.bat`,
  `start-dashboard.bat`, va huong dan repository.
- Chi mang cau hinh provider/agent/team da ra soat va loai secrets, neu can.
  VSIX khong phu thuoc ten user hay duong dan may nguon.

### Khong mang theo

- `.multiagents/`, `peers.db`, DB/WAL/SHM, messages, knowledge, plan history,
  context snapshots, Codex thread/home va thu muc worker rieng.
- `.env`, API keys, credentials, user settings, `node_modules`, `.venv`.
- `.vscode/mcp.json`, `.mcp.json`, `.codex` cua may cu: co the chua duong dan
  tuyet doi, credential references va quyen da cap cho may cu.
- Khong zip toan bo working directory mot cach mu quang. Khong xoa DB may nguon
  hoac ghi de DB co san tren may dich. Session moi van luu local binh thuong.

VSIX nay la CommonJS khong co native dependency, dung duoc tren desktop Windows,
macOS, Linux dap ung phien ban VS Code. Cac buoc MCP ben duoi tap trung Windows;
BAT khong chay tren macOS/Linux. Khong ho tro VS Code Web. Remote/SSH/WSL chua
duoc kiem thu; MCP va extension phai nhin thay cung tool server trong dung host.

## 3. Thiet lap MCP tren may moi

Dieu kien:

- VS Code **1.105+** co Chat hoat dong va workspace duoc trust.
- Bun **1.1+** (ban local da kiem thu voi 1.4.2).
- Neu chay selected-provider workers: Codex CLI tuong thich app-server
  (ban local da kiem thu voi 0.153.4) va tai khoan/API key cua provider.
- Ket noi mang de tai dependencies/cong cu khi can. Cai VSIX san co khong can
  tai build dependencies. GitHub sign-in cua Chat va provider API key la hai
  viec rieng; khong thay the cho nhau.

Trong thu muc source multiagents tren may moi:

```powershell
bun --version
bun install --ignore-scripts
.\setup-copilot.bat --check --no-pause
.\setup-copilot.bat --no-pause
```

`--ignore-scripts` tranh lifecycle postinstall tu dong thay doi MCP cua cac host
khac. Setup Copilot duoc chay rieng, co chu dich. Neu dependency bao can script,
doc script va ra soat truoc khi cho phep; khong bat tat ca mot cach mu quang.

Setup tao/merge `.vscode/mcp.json` cho duong dan moi; khong cai dependencies,
khong tao team va khong tu chay dashboard. Neu bao conflict, giu file hien co
va giai quyet tung muc; khong xoa config de ep setup thanh cong.

Thiet lap catalog provider/model tren may dich theo `docs/copilot-setup.md` va
`shared/model-providers.ts`; can dung Responses API cho selected Codex workers.
Khong copy nguyen catalog chua literal key tu may cu. Nhap keys qua prompt
password cua VS Code hoac credential environment cua host. Khong dan keys vao
Chat, README hoac terminal command. Khong suy doan endpoint/model ID.

Mo **MCP: List Servers**, chon `multiagents-orch`, ra soat trust va Start.
Neu server da chay truoc khi update code, Stop/Start dung server. Khoi dong MCP
co the tao broker local, nhung khong tu tao team. Khong chay hai orchestrator
cung quan ly mot doi. `MULTIAGENTS_CODEX_ALLOW_ALL=1` la opt-in quyen rong:
khong tu bat tren may moi chi vi may cu da bat.

Tu Copilot Agent, thu `list_models` va `get_guide` (chi doc, khong goi provider).
Chat extension can host expose `get_chat_observation`, `control_session`,
`direct_agent`, `remove_agent` qua `vscode.lm.tools`. Neu host khong expose,
extension bao loi, khong tu sinh them MCP server.

## 4. Su dung va kiem tra

Tu 0.1.2: gui `@multiagents` khong tham so, chon MCP/session, sau do chat
binh thuong trong cung cuoc hoi thoai. Khong bat buoc slash command:

- `xem tien do`: doc trang thai, khong chay worker.
- `bat lai tat ca worker`: mot xac nhan cho roster restart/unpause; co canh bao
  phi. Worker dang chay giu nguyen, released bo qua.
- `tiep tuc xu ly task dang ton dong`: resume neu co worker can bat lai;
  neu tat ca da chay, chon worker va xac nhan gui nguyen van yeu cau.
- `theo doi`: stream reports. `doi session`: chon session khac.

Nhan ca tieng Viet co dau/khong dau va mot so cau tieng Anh. Day la bo nhan
dien lenh co gioi han, khong phai model hoi thoai tong quat. Cau phu dinh,
nhieu hanh dong, hoac khong ro se duoc hoi lai; khong tu dong chay.
Extension chi nho session tu participant trong cung chat/cung MCP.
Neu chua co session, doc danh sach MCP va mo picker (hoi ID neu dinh dang
server khong nhan dien duoc). Slash commands van duoc giu cho nguoi can.
Thao tac nhom khong atomic: loi/huy co the de lai mot phan da ap dung;
kiem tra status truoc khi thu lai. Khong rollback hay retry tu dong.

Trong Chat, thay `your-session-id` bang ID thuc te (lay qua MCP `list_sessions`):

```text
@multiagents /status your-session-id
@multiagents /watch your-session-id
@multiagents /interrupt your-session-id | Exact Agent Name
@multiagents /direct your-session-id | Exact Agent Name | Them dieu kien can ap dung
@multiagents /resume your-session-id | Exact Agent Name
@multiagents /pause your-session-id | Exact Agent Name
@multiagents /stop your-session-id | Exact Agent Name
```

Lan dau chon dung tool `get_chat_observation` cua MCP server tin cay.
`/status` khong chay worker. May moi khong co session cu la binh thuong: tao team
moi qua orchestrator sau khi xac nhan thu muc, model/provider, pham vi va phi.
Khong su dung ID cu nhu the lich su da duoc chuyen sang may moi.

- Watch lay mau moi 4 giay, toi da 10 phut/luot, cua so 50 messages gan nhat.
  Day la near-realtime, khong bao dam log lossless khi co burst lon.
- Nut Stop cua Chat chi dung watch. Dung watch roi gui dieu kien/control va
  watch lai. Khong tu dong suy ra worker da dung.
- `/pause` la cooperative; `/interrupt` gui yeu cau ngat Codex turn va giu viec
  moi. Tool dang chay co the van hoan tat; khong rollback file/tac dong.
- `/resume` bo pause cho worker connected; worker disconnected se duoc hoi
  xac nhan rieng truoc khi restart, co canh bao phi provider va nhiem vu cu.
  Worker released khong duoc restart. `/stop` dung mot worker, khong xoa lich su.
  Controls yeu cau xac nhan va ten/slot chinh xac.
- Bao da gui dieu kien khong co nghia agent da ap dung. Cho phan hoi xac nhan.
- Watch khong goi model tom tat, nhung workers van tinh phi provider khi chay.
  Reports di vao lich su Chat; khong dua secrets vao reports/dieu kien.
- Plan 67% hay badge approved khong phai bang chung tests/implementation da xong.

## 5. Tao lai VSIX tu source

```powershell
bun scripts/package-chat.ts
```

Script dung `@vscode/vsce@3.6.2` qua Bun cache (lan dau can mang), khong cai global
hoac publish. Cong cu vsce co the can Node.js runtime tuong thich cua chinh no
tren may build; khong can Node.js rieng tren may chi cai VSIX. Output nam trong
`artifacts/`, lay version tu manifest extension. Chi dong goi manifest,
`extension.cjs`, `core.cjs`, `README.md`; khong kem source MCP hay session.
Package local bo qua yeu cau repository/license-file cua vsce; dieu nay khong
cap them quyen phan phoi hoac publish.

Sau khi sua extension, tang version trong `extensions/multiagents-chat/package.json`
roi build/cai ban moi. Chi restart MCP khong cap nhat extension da cai.

Kiem thu khong goi provider:

```powershell
bun test tests/chat-watch.test.ts tests/chat-participant.test.ts tests/model-selection-recovery.test.ts --timeout 20000
```

Test pass khong thay the kiem tra Chat that: can thay `@multiagents`, chon dung
MCP, `/status` tra ve dung session, va Stop watch khong dung workers.

## 6. Xu ly loi va go cai

- Khong thay `@multiagents`: kiem tra dung profile, VSIX da cai/enabled, Reload
  Window, **Developer: Show Running Extensions**, va **Output: Log (Extension Host)**.
- `No MCP chat observation tool is exposed`: Start dung MCP moi, enable tools,
  kiem tra host Chat; khong khoi dong server thay the de ne loi.
- `Sign in to GitHub to use the Cloud Agent`: loi Copilot Cloud Agent khong tu
  chung minh Multiagents hong. Dung Chat local; neu Chat yeu cau auth, dang nhap
  trong Accounts cua chinh cua so do. Khong chia se token trong log.
- Agent disconnected: `/watch` dung va thong bao, khong tu resume/phat sinh phi.
- Agent Host khong forward MCP co interactive `${input:...}`: xem muc Agent Host
  Limitation trong `docs/copilot-setup.md`; khong thay bang literal secrets.

Go cai trong Extensions > Multiagents Chat > Uninstall, hoac:

```powershell
code --uninstall-extension multiagents-local.multiagents-chat
```

Go extension khong xoa DB/session/keys va khong co nghia worker da dung. Dung
doi chu dong qua orchestrator neu can. Khong can xoa `.multiagents` de go cai.