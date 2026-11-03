# 家园与自定义桌宠模块接入契约 v1

2026-11-03。家园只负责场景布置、来访权限、桌宠展示与所在区域。桌宠的创建、上传、编辑、资产存储及桌面程序由桌宠模块负责。本契约不绑定其数据库设计，也不提供假的桌宠数据。

## 队友的接入点

实现 `src/lib/pets/home-pet-source.ts` 中的两个服务端查询，保持 `HomePetProvider` 签名：

```ts
interface HomePetProvider {
  listOwned(ownerId: string): Promise<HomePetDefinition[]>;
  getOwned(ownerId: string, petId: string): Promise<HomePetDefinition | null>;
}
```

`ownerId` 来自平台用户 ID。只返回此用户拥有、可展示的桌宠；删除或没有权限返回 null。查询复用桌宠模块自己的权限逻辑，家园还会复核 ownerId 和 petId。不要将 PAT、模型密钥、上传凭证或桌面本地路径放进返回值。

未接入时两个查询分别返回 [] 和 null。用户可以布置和参观家园，界面显示中性展示位，不生成小猫、兔子或其他假桌宠。

## 资源格式

类型与校验在 `src/lib/pets/home-pet-contract.ts`，`HOME_PET_CONTRACT_VERSION = 1`：

```ts
const pet = {
  id: "custom:my-pet", // 最长 128 字符，字母/数字/_/:/./-；不是文件路径
  ownerId: "<平台用户 UUID>",
  name: "伙伴名字",
  appearance: {
    type: "image",
    src: "/api/pets/my-pet/image",
    width: 128,
    height: 192,
  },
};
```

图片也可替换为精灵图：

```ts
const appearance = {
  type: "spritesheet",
  src: "/pets/my-pet/sheet.webp",
  frameWidth: 96,
  frameHeight: 128,
  columns: 8,
  rows: 2,
  idle: { start: 0, count: 8, fps: 8 },
  greet: { start: 8, count: 8, fps: 12 }, // 可选，缺少时沿用 idle
};
```

帧从 0 开始，先横向后纵向编号。图集必须是等尺寸格子，动作不可超出图集。展示组件以 100×112 为公共视口、(50,100) 为脚底中点，等比例缩放，不拉伸图像。资源自身的脚底应位于帧底部中央；第一版不支持多方向或不规则帧。减少动态效果设置会停用帧动画。

`src` 仅允许本站 `/pets/` 或 `/api/pets/` 下的图片 URL，不接收 data/javascript、跨站地址、查询凭证、反斜杠或 `..` 路径段。建议透明背景 PNG/WebP。资源服务应校验访问者权限，允许主人及具有家园/庭院访问权限的成员读取，并返回正确的 image/* 类型。资源端点由桌宠模块实现；家园不创建下载代理。

图片加载失败时显示占位，不伪装成已加载。合影会在当前用户权限下读取图像并内嵌到 SVG 下载中，单张资源最多 5 MiB；合影不上传或自动发布。

## 家园提供的接口

- `GET /api/home/pets`：网页登录，返回 `{ schemaVersion: 1, selectedPetId, pets }`；仅本人可选桌宠，响应 private,no-store。
- `PUT /api/home/pets`：`{ petId: "custom:my-pet" }` 选择；`{ petId: null }` 清空。服务端按当前会话复核所有权，忽略客户端 ownerId 和外观。选择后先回自己家，不直接进入团队庭院。
- `POST /api/home` 的 move 操作沿用原团队权限。未绑定/已失效桌宠不能进入庭院；仍可召回，避免删除或离队后留下无法解除的位置。

家园仅在现有 `home_profiles.pet` JSON 中增加可选 petId。旧 kind/name 保持可读，但不再决定外观。普通布局保存不修改桌宠关联，防止旧窗口覆盖队友模块的选择。资产和外观始终按 ownerId + petId 向来源模块读取，不把图片复制到家园表；无需新增表或重建已有家园。

## 合并边界

桌宠负责人优先只改来源适配器及自己的模块；如要改变契约，先同步此文档和契约测试。家园 UI 不 import 桌宠创建页面或桌面运行时；桌宠模块不必改家具、家园权限或任务代码。统一渲染组件为 `src/components/pets/home-pet-avatar.tsx`，场景只传入 idle/greet 动作。

这里的家园/庭院位置是网页区域记录，不等于桌面程序的位置或在线状态。跨桌面状态同步、进食/睡眠、自主互动和资源上传不在本轮实现范围内。
