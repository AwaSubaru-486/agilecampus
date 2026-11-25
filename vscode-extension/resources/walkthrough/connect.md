# 网页和插件连接同一个项目

1. 在浏览器打开团队使用的 AgileCampus 网站，从网页设置页创建 Personal API Token。
2. 在 VS Code 设置里搜索 `agileCampus.baseUrl`，填入同一个站点地址。团队站点使用 HTTPS，本机开发可以使用 `http://localhost:3000`。
3. 点击 **连接项目**，在 VS Code 的密码输入框中输入令牌，选择网页上同一个项目和本地仓库。

连接成功后，侧栏会显示项目名称和任务列表。每位组员使用自己账号创建的令牌。
