# venera-sources

给 [Venera](https://github.com/venera-app/venera) / [VeneraX](https://github.com/Kyosee/VeneraX)
（`io.github.kyosee.venera`）用的自建漫画源集合。

## 收录的源

| 源 | 站点 | 版本 | 说明 |
| --- | --- | --- | --- |
| Hachiraw | hachiraw.win | 1.1.0 | 日漫 RAW，25 个题材分类 + 最新更新 |
| 包子漫画 | bzmgcn（tw 镜像） | 1.1.0 | 题材 × 地区 × 连载状态 组合浏览 |

## 安装

在 App 的「漫画源 → 添加源仓库」里填入以下任一地址：

```
https://raw.githubusercontent.com/YUIRIKIiii/venera-sources/main/index.json
```

国内网络访问 GitHub 较慢时，可以用 jsDelivr 镜像：

```
https://cdn.jsdelivr.net/gh/YUIRIKIiii/venera-sources@main/index.json
```

添加后刷新源列表即可看到「Hachiraw」与「包子漫画」。

## 功能说明

### Hachiraw

- **探索**：`最新更新`，即站点首页的全量更新列表，可分页。
- **分类**：把站点 `Action / Fantasy / Ecchi / Harem / Adult / Romance …` 等
  25 个有内容的题材收拢到「分类」页，标签使用中文（动作 / 奇幻 / 色气 / 后宫 /
  成人 / 恋爱 …），点进去即为该题材的分页列表。
  （站内 `武侠 / 百合` 两个分类本身没有作品，已剔除，不占位置。）
- **搜索**：站点服务端搜索已失效，本源改为「按最新列表逐页拉取 + 标题本地匹配」，
  因此结果只覆盖最近的更新；也支持直接粘贴 `https://hachiraw.win/manga-xxx/` 打开。
- **阅读**：章节图在 `data-src` 上（含 tiktokcdn 无扩展名链接），已补 `Referer` 绕过防盗链。

### 包子漫画

- **探索**：只保留 `最新更新`，原来平铺的 10 个入口全部整合进「分类」。
- **分类**：`题材` 一栏是站点的 26 个题材（全部 / 恋爱 / 纯爱 / 古风 / 异能 …）；
  进入题材列表后，顶部还有两个选项：
  - **地区**：全部 / 国漫 / 日漫 / 韩漫 / 欧美
  - **状态**：全部 / 连载中 / 已完结
  三个维度可以自由组合，例如「韩漫 + 已完结 + 恋爱」。
- **搜索**：站点 `/search?q=` 直接可用。
- **阅读**：走 `tw.bzmgcn.com` 镜像，`language=cn` 拿简体书名。

## 已知限制

- **包子漫画的书名靠详情接口取简体**：列表接口与详情接口都能指定 `language=cn`，
  本源的详情页会额外请求 `https://tw.bzmgcn.com/api/bzmhq/comic?comic_id=<id>&language=cn`
  拿简体书名、简介、题材、地区、状态；该接口不可用时回退到页面里的 `og:novel:*` 元信息。
- **包子漫画不走官方域名**：`cn.` / `www.` 对阅读页启用了 gatekeeper 工作量证明
  （SHA-256 PoW + 浏览器指纹），纯 JS 请求无法通过，因此统一走 tw 镜像。
- **Hachiraw 没有服务端搜索**，本地匹配仅覆盖最近约 5 页 × 每页 20 部的更新。
- 两个源都要求 App 版本 ≥ 1.6.0（分类页 / `categoryComics` 依赖该版本）。

## 自定义

源文件就是普通 JS，直接改 `xxx.js` 即可：

- 题材增删：改 `category.parts[0].categories` 与一一对应的 `categoryParams`。
- Hachiraw 新增题材时，编号即站点 `https://hachiraw.win/category/<编号>/` 里的数字。
- 包子漫画的题材参数取自站点 `/classify` 页的 `type=` 值（拼音），
  地区 / 状态取自同页的 `region=`、`state=`。
- 改完记得同步提升文件内的 `version` 与 `index.json` 中的 `version`，
  App 靠它判断是否需要更新源。
