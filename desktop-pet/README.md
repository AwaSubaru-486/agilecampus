# AgileCampus 桌面陪伴 0.1.0

这是仅负责桌宠的 Windows 程序，不打包项目管理网页。网页继续在浏览器中使用，桌宠通过独立透明置顶窗口显示；浏览器最小化或关闭不会退出桌宠。

## 普通使用

1. 从家园的“桌面陪伴 → 首次使用与下载”下载 ZIP。
2. 解压整个 AgileCampusPet 文件夹，运行 AgileCampusPet.exe。不要只复制 exe，其他文件也是运行所需。
3. 网页打开家园，点击“开启桌面陪伴”，再点击“打开桌宠程序”。首次浏览器可能要求确认打开外部应用。
4. 客户端会显示服务地址，确认后连接。网页收到真实心跳才显示运行中。
5. 已选择的自定义桌宠会自动出现；当前桌宠模块未提供资源时显示明确占位。可以先连接程序，之后在家园选择桌宠，客户端约 5 秒同步。

直接拖动宠物调整位置，点击打招呼，右键打开菜单：返回家园、前往庭院、隐藏、调整大小、找回屏幕内和退出。系统托盘也有相同菜单；隐藏后双击托盘图标恢复。

网页“找到桌宠”发送显示请求，隐藏/显示的真实状态由客户端回执更新。断开连接会撤销此账号的桌宠凭据；关闭客户端不清空家园。凭据有效期 7 天，到期从网页重新连接。网络中断保留已加载图片并显示离线提示，不伪造在线状态。

退出客户端后可用 `AgileCampusPet.exe --unregister` 注销 agilecampus-pet 协议，再删除便携目录。移动目录后重新运行一次即可更新协议注册位置。便携包未做代码签名和自动更新，不设置开机自启。

## 开发和构建

在仓库根目录：

```powershell
npm run pet:install
npm run pet:dev
npm run pet:test
npm run pet:build
```

Node.js 需满足当前 Electron 包的要求（本版 >=22.12）。Electron 首次下载运行时需联网。依赖与锁文件放在 desktop-pet 内，不改变主站的前端依赖。

构建输出：`.local/desktop-release/AgileCampusPet/AgileCampusPet.exe` 和 `.local/desktop-release/AgileCampusPet-Windows-x64.zip`。Windows x64 本地构建使用系统 tar.exe 创建 ZIP。重建前先退出旧便携程序，避免运行时文件被占用。

部署服务器时将 ZIP 放在服务器工作目录的 `.local/desktop-release/`，登录用户即可从下载接口取得；Next standalone 部署需放在实际运行工作目录中。没有 ZIP 时接口明确返回未提供，不下载其他程序。

服务端需要新增 desktop_pet_connections 表：使用原有 db:push，或执行 `scripts/migrations/2026-11-03-desktop-pet-connections.sql`。本地开发库和测试库已同步。

## 桌宠模块对接

读取现有 HomePetProvider 的 getOwned(ownerId, petId)，静态图片、精灵图 idle/greet 复用家园同一份定义。桌面显示与家园/庭院活动位置独立，不会为显示桌宠而改动 petTeamId。

资源：

- `/pets/...` 公共资源可直接放入 public/pets，网关校验实际路径、文件签名和 5 MiB 上限。
- 受保护的 `/api/pets/...` 资源，桌宠模块实现可选的 readAssetOwned(ownerId, petId)，返回 `{ bytes, mimeType }`。不能转交浏览器 Cookie、上传凭据或本地路径。
- 桌面网关只返回当前账号选中的图片，接受 PNG/WebP/GIF/JPEG。使用规则精灵图实现动作；GIF 作为 image 输入时不保证逐帧播放。

主进程通过固定服务端点获取图像，再把 data URL 交给本地渲染器。渲染器不能任意联网、读取文件或执行 Node；客户端不加载远程 HTML。图片读取失败显示错误占位，不改用他人的宠物。

## 连接与权限

网页创建 90 秒一次性邀请，通过 agilecampus-pet://connect 唤起本机客户端。客户端确认 HTTPS/回环服务地址后领取受限凭据；并发领取只能成功一次。数据库只保存哈希，新的连接撤销旧连接。

客户端凭据仅由桌宠 state/asset 接口识别，不能调用项目 Agent API；不会把平台 PAT 或网页登录 Cookie 交给渲染器。凭据优先使用异步操作系统 safeStorage 加密；部分 Windows 的异步后端不可用时回退到系统同步加密。两者都不可用时仅保留本次运行的内存连接，不保存明文。

窗口主进程启用 contextIsolation、sandbox，关闭 Node integration；禁止新窗口和页面导航，IPC 仅允许显示控制、菜单、家园固定链接和有限拖动。透明区域按图像 alpha 穿透鼠标。Windows 多屏位置限制在工作区内，拔掉屏幕后可找回。

## 测试边界

测试模式 `--test-mode` 不注册协议、不持久化凭据、跳过服务地址确认；仅用于受控原生自动化验收。正常模式始终保留首次连接确认。

已使用真实 Electron 窗口验证透明截图 alpha、置顶、拖动、隐藏与命令回执；使用临时账号连接真实网页，最小化和关闭真实浏览器后客户端仍运行。图像渲染用合成测试资源，未将其作为真实用户桌宠发布。队友真实桌宠的最终资产仍需接入后验收。
