/**
 * 包子漫画 (bzmgcn) 漫画源
 * 适配 Venera / VeneraX (io.github.kyosee.venera)
 *
 * 说明：
 * - cn.bzmgcn.com / www.bzmgcn.com 对阅读页启用了 gatekeeper 工作量证明挑战
 *   （SHA-256 PoW + 浏览器指纹绑定），纯脚本请求无法通过，故统一走
 *   tw.bzmgcn.com 镜像；列表接口传 language=cn 可拿到简体书名。
 * - 列表走 JSON 接口 /api/bzmhq/amp_comic_list，比解析 HTML 稳定。
 * - 详情页为 SSR，章节链接形如 /user/page_direct?comic_id=&section_slot=&chapter_slot=。
 * - 阅读页图片在 data-src，路径含 /scomic/，无需 Referer 防盗链。
 */
class BzmgcnSource extends ComicSource {
    name = "包子漫画"
    key = "bzmgcn"
    version = "1.0.0"
    minAppVersion = "1.6.0"

    // 源更新检测地址（改成你自己的 raw 链接）
    url = "https://raw.githubusercontent.com/YUIRIKIiii/venera-sources/main/bzmgcn.js"

    base = "https://tw.bzmgcn.com"
    coverBase = "https://static-tw.bzmgcn.com/cover"
    pageSize = 36

    get headers() {
        return {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": this.base + "/",
        }
    }

    async getText(url) {
        let res = await Network.get(url, this.headers)
        if (res.status !== 200) {
            throw `请求失败 ${res.status}: ${url}`
        }
        return res.body
    }

    async getJson(url) {
        let body = await this.getText(url)
        try {
            return JSON.parse(body)
        } catch (e) {
            throw `接口返回非 JSON: ${url}`
        }
    }

    decode(s) {
        return (s || "")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&nbsp;/g, " ")
    }

    strip(s) {
        return this.decode((s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    }

    // 从 og:xxx 或 name="description" 里取值
    meta(html, key) {
        let m =
            html.match(new RegExp('name="' + key + '" content="([^"]*)"')) ||
            html.match(new RegExp('property="' + key + '" content="([^"]*)"')) ||
            html.match(new RegExp('content="([^"]*)" name="' + key + '"'))
        return m ? this.decode(m[1]) : ""
    }

    // id 兼容完整链接、带斜杠、带 query 的写法
    normalizeId(id) {
        let s = String(id || "")
        let m = s.match(/bzmgcn\.com\/comic\/([^\/?#]+)/)
        if (m) return m[1]
        s = s.replace(/^\/+|\/+$/g, "")
        return s.replace(/^comic\//, "").split("?")[0]
    }

    coverUrl(topicImg, id) {
        if (topicImg) {
            if (topicImg.startsWith("http")) return topicImg
            return this.coverBase + "/" + topicImg
        }
        return this.coverBase + "/" + id + ".jpg"
    }

    /**
     * 分类列表
     * @param {{type?:string, region?:string, state?:string, filter?:string}} p
     * @param {number} page 1-based
     */
    async loadList(p, page) {
        let n = page || 1
        if (n < 1) n = 1
        let type = (p && p.type) || "all"
        let region = (p && p.region) || "all"
        let state = (p && p.state) || "all"
        let filter = (p && p.filter) || "*"
        let url =
            `${this.base}/api/bzmhq/amp_comic_list?type=${type}&region=${region}` +
            `&state=${state}&filter=${encodeURIComponent(filter)}&page=${n}&limit=${this.pageSize}&language=cn`
        let data
        try {
            data = await this.getJson(url)
        } catch (e) {
            // 翻到最后一页之后站点会返回 406，按“没有更多”处理
            if (n > 1) return { comics: [], maxPage: n }
            throw e
        }
        let items = data.items || []
        let comics = []
        for (let it of items) {
            if (!it || !it.comic_id) continue
            comics.push(
                new Comic({
                    id: it.comic_id,
                    title: this.decode(it.name || it.comic_id),
                    cover: this.coverUrl(it.topic_img, it.comic_id),
                    subTitle: this.decode(it.author || ""),
                    tags: it.type_names || [],
                    description: "",
                })
            )
        }
        // 只要这一页还有内容，就允许继续往后翻
        let maxPage = comics.length > 0 ? n + 1 : n
        return { comics: comics, maxPage: maxPage }
    }

    tab(title, p) {
        return {
            title: title,
            type: "multiPageComicList",
            load: async (page) => this.loadList(p, page),
        }
    }

    explore = [
        {
            title: "最新更新",
            type: "multiPageComicList",
            load: async (page) => this.loadList({}, page),
        },
        {
            title: "国漫",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ region: "cn" }, page),
        },
        {
            title: "日漫",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ region: "jp" }, page),
        },
        {
            title: "韩漫",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ region: "kr" }, page),
        },
        {
            title: "欧美",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ region: "en" }, page),
        },
        {
            title: "连载中",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ region: "cn", state: "serial" }, page),
        },
        {
            title: "已完结",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ region: "cn", state: "pub" }, page),
        },
        {
            title: "热血",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ region: "cn", type: "rexie" }, page),
        },
        {
            title: "恋爱",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ region: "cn", type: "lianai" }, page),
        },
        {
            title: "玄幻",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ region: "cn", type: "xuanhuan" }, page),
        },
    ]

    // 搜索区段：从 l-content search 到 footer
    searchSegment(html) {
        let start = html.indexOf("l-content search")
        if (start < 0) return ""
        let end = html.indexOf('<div class="footer"', start)
        if (end < 0) end = html.length
        return html.substring(start, end)
    }

    // 解析漫画卡片（列表/搜索结果通用）
    parseCards(html) {
        let comics = []
        if (!html) return comics
        let parts = html.split('<div class="comics-card')
        let seen = new Set()
        for (let i = 1; i < parts.length; i++) {
            let block = parts[i]
            let idM = block.match(/href="\/comic\/([^"?#]+)"/)
            if (!idM) continue
            let id = idM[1]
            if (seen.has(id)) continue
            seen.add(id)
            let titleM = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)
            let title = titleM ? this.strip(titleM[1]) : ""
            if (!title) {
                // 搜索结果卡片没有 h3，书名在 a 标签的 title 属性上
                let attrM = block.match(/<a[^>]*href="\/comic\/[^"]*"[^>]*title="([^"]*)"/) ||
                    block.match(/title="([^"]*)"[^>]*href="\/comic\//)
                if (attrM) title = this.decode(attrM[1])
            }
            if (!title) title = id
            let cover = ""
            let coverRe = /(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi
            let cm
            while ((cm = coverRe.exec(block)) !== null) {
                if (cm[1].indexOf("default_cover") >= 0) continue
                cover = cm[1]
                break
            }
            if (!cover) cover = this.coverBase + "/" + id + ".jpg"
            let subM = block.match(/<small[^>]*class="[^"]*tags[^"]*"[^>]*>([\s\S]*?)<\/small>/)
            comics.push(
                new Comic({
                    id: id,
                    title: title,
                    cover: cover,
                    subTitle: subM ? this.strip(subM[1]) : "",
                    tags: [],
                    description: "",
                })
            )
        }
        return comics
    }

    search = {
        load: async (keyword, _, page) => {
            let kw = (keyword || "").trim()
            if (!kw) return { comics: [], maxPage: 1 }
            let html = await this.getText(
                `${this.base}/search?q=${encodeURIComponent(kw)}`
            )
            let comics = this.parseCards(this.searchSegment(html))
            return { comics: comics, maxPage: 1 }
        },
    }

    comic = {
        loadInfo: async (id) => {
            let cid = this.normalizeId(id)
            let url = `${this.base}/comic/${cid}`
            let html = await this.getText(url)

            let title = this.meta(html, "og:novel:book_name") || cid
            let cover =
                this.meta(html, "og:image") || `${this.coverBase}/${cid}.jpg`
            let desc = this.meta(html, "og:description")
            let author = this.meta(html, "og:novel:author")
            let status = this.meta(html, "og:novel:status")
            let category = this.meta(html, "og:novel:category")

            let tags = new Map()
            let cats = category
                .split(/[,，]/)
                .map((x) => x.trim())
                .filter((x) => x.length > 0)
            if (cats.length > 0) tags.set("分类", cats)
            if (author) tags.set("作者", [author])
            if (status) tags.set("状态", [status])

            // 章节：/user/page_direct?comic_id=..&section_slot=0&chapter_slot=236
            // 页面里同一批章节会出现两次（最新 + 全部），按 section/slot 数字升序去重排序
            let chapters = new Map()
            let items = []
            let seenEp = new Set()
            let chRe =
                /href="\/user\/page_direct\?comic_id=([^"&]+)&(?:amp;)?section_slot=(\d+)&(?:amp;)?chapter_slot=(\d+)"[^>]*class="comics-chapters__item"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/g
            let m
            while ((m = chRe.exec(html)) !== null) {
                let sec = parseInt(m[2])
                let slot = parseInt(m[3])
                let ep = `${sec}_${slot}`
                if (seenEp.has(ep)) continue
                seenEp.add(ep)
                let name = this.strip(m[4])
                items.push({ ep: ep, name: name || ep, sec: sec, slot: slot })
            }
            items.sort((a, b) => (a.sec - b.sec) || (a.slot - b.slot))
            for (let c of items) {
                chapters.set(c.ep, c.name)
            }

            return new ComicDetails({
                title: title,
                subtitle: status,
                cover: cover,
                description: this.strip(desc),
                tags: tags,
                chapters: chapters,
                url: url,
            })
        },

        loadEp: async (comicId, epId) => {
            let cid = this.normalizeId(comicId)
            let url = `${this.base}/comic/chapter/${cid}/${epId}.html`
            let html = await this.getText(url)
            let images = []
            let seen = new Set()
            let re = /data-src="(https?:\/\/[^"]*\/scomic\/[^"]+)"/g
            let m
            while ((m = re.exec(html)) !== null) {
                let u = m[1]
                if (seen.has(u)) continue
                seen.add(u)
                images.push(u)
            }
            if (images.length === 0) {
                // 兜底：正文容器里的任意大图
                let re2 =
                    /class="comic-contain__item"[^>]*?data-src="([^"]+)"/g
                while ((m = re2.exec(html)) !== null) {
                    if (seen.has(m[1])) continue
                    seen.add(m[1])
                    images.push(m[1])
                }
            }
            if (images.length === 0) {
                throw `未解析到图片，可能章节需要其他章节或站点改版: ${url}`
            }
            return { images: images }
        },

        // 支持直接粘贴详情页链接
        idMatch: "bzmgcn\\.(?:com|net)\\/comic\\/([a-zA-Z0-9\\-_]+)",
        link: {
            domains: [
                "tw.bzmgcn.com",
                "cn.bzmgcn.com",
                "www.bzmgcn.com",
                "bzmgcn.com",
            ],
            linkToId: (url) => {
                let m = String(url).match(/bzmgcn\.com\/comic\/([^\/?#]+)/)
                return m ? m[1] : null
            },
        },
    }
}
