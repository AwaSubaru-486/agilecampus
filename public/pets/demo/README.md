# 小青：临时演示桌宠

2026-11-03，按用户“先随便试一个桌宠”的要求生成。明确标注为演示，不属于队友的正式自定义桌宠模块。

- 素材：qing-bot.png，1214×1295，PNG RGBA，保留生成结果的透明通道，没有背景移除或二次改图。
- 使用内置 image_gen 工具生成，并从 Codex generated_images 复制到当前项目。
- 客户端 `AgileCampusPet.exe --demo` 或右键菜单“体验演示桌宠：小青”可离线预览；不绑定账号、不修改家园、不写测试用户。
- 本地 `.env` 已启用 `HOME_DEMO_PET_ENABLED=true`，家园可选列表会出现用户范围内的演示项；默认 `.env.example` 关闭。用户仍需明确选择才改变家园关联。
- 后续关闭开关即可恢复无演示项；队友接入真实来源时可移除 home-pet-source.ts 中的演示调用。创建/上传/桌面接口保持原样。

## 最终生成提示词

Use case: stylized-concept. Asset type: transparent PNG desktop companion for a university collaboration web app. Create ONE adorable compact small robot mascot, full body, front-facing slight three-quarter view, rounded white ceramic shell, dark teal face screen with two warm friendly mint LED eyes, small teal-green accents, short rounded legs, simple articulated arms with one hand slightly raised in greeting. Polished soft 3D product-render style, clean and restrained rather than hand-drawn doodle or cartoon illustration. The robot must remain legible at 150 pixels tall. Center the complete robot, including feet and antenna, with modest transparent margin. Genuine transparent alpha background, no floor, no scene, no cast shadow, no pedestal. No text, lettering, logo, watermark, or other objects. Single character only, single static image, not a sprite sheet. This is an explicitly temporary demo pet.
