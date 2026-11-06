# QSL 卡片与信封打印程序 · Docker 部署包

给业余无线电台 BH6AJS（QTH OM72）用的 QSL 卡片、信封打印程序：通联记录一键出卡片、按呼号出信封，支持在线改数据、导入 ADIF 日志、导出 Word、打印。

## 功能一览

- **卡片打印**：一张通联记录一张卡片（不去重），2025 版 / 2024 版两种原版式切换；QTH 统一为寄件人自己的网格定位 OM72；时间可在 UTC / 北京时间之间切换（默认北京时间）；每格内容可直接点击修改。
- **信封打印**：按呼号一份，取最新日期的完整地址；支持国标 GB/T 1416 西式信封规格选择（DL 220×110 / C5 229×162 / C6 162×114 / B6 176×125，默认 C5，可改、选择会保存）；右上角邮资区在打印和 Word 导出时完全留空（邮资封已印邮资，不可覆盖污损），屏幕上仅以虚线示意；收信人地址、姓名不带框。
- **数据管理**：通联记录、收信地址、寄件人信息都能新增、修改、删除，存在服务器上。
- **快速查地址**：每条呼号旁边都有“查地址”按钮，点开是该呼号的 QRZ 主页（新标签页）；数据页顶部还有呼号搜索框，输入呼号回车直达 QRZ 主页。17 个待补地址的呼号每行都有按钮和补录表单。
- **导入 ADIF**：上传 `.adi` / `.adif` 日志文件，解析预览、标出文件内重复条目和已在表中的记录，勾选后导入；导入时按呼号自动匹配已有收信地址。
- **导出 Word**：卡片和信封分章节导出 `.docx`，可在 Word 里再调整后打印；也可直接打印（卡片 A4 每页 3 张，信封一页一个）。

首次启动自动用内置的 247 条通联记录、213 个信封地址做种子；之后你改的任何数据都存在挂载的数据卷里，重启、升级都不会丢。

## 一、部署（通用）

这个包不绑定任何 NAS 品牌，任何能跑 Docker 的机器（NAS、Linux 服务器、Windows/Mac 装了 Docker Desktop 的电脑）都一样部署。

### 方式 A：docker compose（推荐）

```bash
# 1. 把本文件夹（QSL打印程序_Docker部署包 解压后的全部内容）传到机器上，进入该目录
cd qsl-docker

# 2. 启动（首次会先构建镜像，需要几分钟）
docker compose up -d

# 3. 打开浏览器访问
#    http://机器IP:8080
```

停止：`docker compose down`（数据保留在 ./data 里）；看日志：`docker compose logs -f`；重启：`docker compose restart`。

### 方式 B：docker run（不用 compose 也行）

```bash
docker build -t qslprint:latest .

docker run -d -p 8080:8000 -v ./data:/app/data --name qslprint --restart unless-stopped qslprint:latest
```

## 二、在 NAS 上部署

上面两种通用方式在 NAS 上同样适用：

- **群晖**：打开 Container Manager（套件中心里安装）→ 项目 → 新增 → 上传本文件夹（或把文件夹传到 NAS 后选路径）→ 构建并启动；也可以在“映像”里拉取镜像后用 `docker run` 同款参数创建容器。
- **威联通**：打开 Container Station → 创建应用程序（用 docker-compose.yml）或创建容器（用已构建/已拉取的镜像），端口、数据卷按上面配置填即可。

访问地址都是 `http://NAS的IP:8080`，例如 NAS 的 IP 是 192.168.1.100，就打开 `http://192.168.1.100:8080`。

## 三、改端口

默认主机端口是 **8080**。如果 8080 已被占用，改 `docker-compose.yml` 里的端口映射，冒号左边改成别的，例如：

```yaml
ports:
  - "8090:8000"
```

改完执行 `docker compose up -d`，然后用 `http://机器IP:8090` 访问。冒号右边 8000 是容器内端口，不要改。

## 四、数据与备份

- 全部数据存在程序目录下的 `data/data.json`（容器内是 `/app/data/data.json`），包括通联记录、收信地址、寄件人信息。
- **备份**：直接复制 `data` 文件夹即可。建议定期把 `data/data.json` 拷一份到电脑上。
- **恢复**：停掉容器，把备份的 `data.json` 放回 `data/`，再启动。
- **重置回初始数据**：停掉容器，删除 `data/data.json`，再启动会自动重新用 247 条种子记录初始化（你后来改的数据会丢失，操作前请先备份）。

## 五、更新程序

```bash
cd qsl-docker
docker compose down
docker compose up -d --build
```

数据在 `./data` 卷里，更新不会丢。

## 六、发布到 Docker Hub

把镜像推到 Docker Hub 后，别的机器不用传代码、不用本地构建，直接拉镜像就能跑。

```bash
# 1. 先在 Docker Hub 网站（hub.docker.com）注册账号，并新建一个公开仓库，仓库名建议 qslprint

# 2. 在放 Dockerfile 的目录执行构建（把 <你的DockerHub用户名> 换成你自己的 Docker Hub 用户名）
docker build -t <你的DockerHub用户名>/qslprint:latest .

# 3. 登录 Docker Hub（按提示输入账号和密码；密码不要写进任何文件）
docker login

# 4. 推送镜像
docker push <你的DockerHub用户名>/qslprint:latest
```

在 NAS 或别的机器上使用已发布的镜像（二选一）：

```bash
# 方式一：直接拉取运行
docker pull <你的DockerHub用户名>/qslprint:latest
docker run -d -p 8080:8000 -v ./data:/app/data --name qslprint <你的DockerHub用户名>/qslprint:latest

# 方式二：用 docker compose
# 把 docker-compose.yml 里的 build: . 注释掉，取消 image: <你的DockerHub用户名>/qslprint:latest 的注释，
# 然后执行 docker compose up -d
```

**安全说明**：镜像里不含你自己的通联数据——数据存在挂载的 `./data` 卷里，不会打进镜像；首次启动自动用内置的 247 条种子记录初始化。推到公开仓库是安全的。

## 七、常见问题

- **打不开页面**：先看容器是否在跑：`docker ps` 里找 `qslprint`；再看日志：`docker compose logs`。确认访问地址是 `http://机器IP:8080`（不是 localhost，如果你是在别的电脑上访问）。
- **端口被占用**：按“三、改端口”换一个主机端口。
- **构建失败**：检查网络（构建时要从网上下载 Python 基础镜像和 Flask、python-docx），把报错信息发回来。
- **信封尺寸不对**：在信封页顶部切换 DL / C5 / C6 / B6，选择会保存；打印前请用打印预览核对一次。
- **卡片上的时间**：种子数据里的时间是 UTC；页面顶部切换 UTC / 北京时间后，卡片显示会自动换算（北京时间 = UTC+8）。
- **ADIF 导入后地址为空**：ADIF 文件里本身没有收信地址字段，地址需要用“查地址”按钮去 QRZ 查到后补录，或直接在数据页补录。

## 包里有什么

```
qsl-docker/
├── Dockerfile            # 镜像构建文件（python:3.12-slim + Flask + python-docx）
├── docker-compose.yml    # 一键启动配置（端口 8080、数据卷 ./data）
├── requirements.txt      # Python 依赖（Flask、python-docx）
├── README.md             # 本文件
├── .dockerignore
├── data/                 # 数据卷目录（首次启动后生成 data.json；备份它）
└── app/
    ├── server.py         # 后端（Flask + JSON 数据 + Word 导出）
    ├── seed_data.json    # 种子数据（247 条通联记录、213 个信封地址）
    └── static/
        ├── index.html    # 前端页面
        ├── app.js        # 前端逻辑
        ├── style.css     # 样式（含打印样式）
        ├── logo.png      # CRAC 标志（从用户卡片上裁剪）
        └── qr.png        # 二维码（收信地址登记表链接重新生成）
```
