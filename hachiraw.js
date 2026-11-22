/**
 * Hachiraw (https://hachiraw.win/) 漫画源
 * 适配 Venera / VeneraX (io.github.kyosee.venera)
 *
 * 说明：
 * - 探索页只放"最新更新"（发现页标签为「Hachiraw 最新」）；站点的 25 个题材
 *   （Action / Fantasy / Ecchi …）统一收进「分类」页，标签为中文，
 *   点进去是 /category/<id>/page/<n>/ 分页列表。
 * - 发现页标签以 explore 页 title 为唯一标识（全局唯一），因此带源名前缀，
 *   避免与其它源的「最新更新」标签互相覆盖。
 * - 该站无可用服务端搜索（/?s= 与 /search?s= 均被忽略），
 *   因此 search 采用"拉取最新列表 + 本地标题匹配"的兜底方式；
 *   也支持直接粘贴漫画详情页链接打开。
 * - 章节图片为懒加载，真实地址在 <img data-src="...">。
 */
class Hachiraw extends ComicSource {
    name = "Hachiraw"
    key = "hachiraw"
    version = "1.1.1"
    minAppVersion = "1.6.0"
    // 源更新检测地址（指向源库中本文件的 raw 链接）
    url = "https://raw.githubusercontent.com/YUIRIKIiii/venera-sources/main/hachiraw.js"

    base = "https://hachiraw.win"

    // 题材 id -> 中文名（与下方分类页的 categoryParams 一一对应）
    genreNames = {
        6: "动作", 7: "成人", 8: "冒险", 9: "喜剧", 10: "剧情",
        11: "色气", 12: "奇幻", 13: "性转", 14: "后宫", 15: "历史",
        16: "恐怖", 17: "武侠", 18: "成熟", 19: "机甲", 20: "悬疑",
        21: "心理", 22: "恋爱", 23: "校园", 24: "科幻", 25: "青年",
        26: "少女", 27: "百合", 28: "少年", 29: "耽美", 30: "日常",
        31: "运动",
    }

    get headers() {
        return {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml",
            "Referer": this.base + "/",
        }
    }

    async fetchHtml(url) {
        let res = await Network.get(url, this.headers)
        if (res.status !== 200) {
            throw `请求失败 ${res.status}: ${url}`
        }
        return res.body
    }

    // 取绝对 URL
    abs(path) {
        if (!path) return ""
        if (path.startsWith("http")) return path
        if (path.startsWith("//")) return "https:" + path
        if (path.startsWith("/")) return this.base + path
        return this.base + "/" + path
    }

    strip(s) {
        return (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
    }

    // 截取 entry-content 正文块（到页脚 / 标签 / 评论区 / 文章结束为止）
    contentBlock(html) {
        let lower = html.toLowerCase()
        let start = lower.indexOf('class="entry-content"')
        if (start < 0) return ""
        let rest = html.slice(start)
        let restLower = rest.toLowerCase()
        let end = rest.length
        let marks = [
            "</article>",
            'class="entry-footer"',
            'class="post-tags',
            'class="entry-tags',
            'id="comments',
            'class="post-navigation',
            'class="related',
        ]
        for (let mk of marks) {
            let i = restLower.indexOf(mk)
            if (i >= 0 && i < end) end = i
        }
        return rest.slice(0, end)
    }

    // 解析列表卡片 <article class="post manga"> ... </article>
    parseList(html) {
        let comics = []
        let artRe = /<article[^>]*class="[^"]*post[^"]*manga[^"]*"[^>]*>[\s\S]*?<\/article>/g
        let m
        let seen = new Set()
        while ((m = artRe.exec(html)) !== null) {
            let block = m[0]
            let linkM = block.match(/href="(\/manga-[^"]+)"/)
            if (!linkM) continue
            let path = linkM[1]
            if (seen.has(path)) continue
            seen.add(path)
            let titleM = block.match(/class="entry-title"[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/)
            let imgM = block.match(/data-src="([^"]+)"/) || block.match(/src="(https?:[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i)
            comics.push(new Comic({
                id: path, // 形如 /manga-xxx/
                title: this.strip(titleM ? titleM[1] : path),
                cover: imgM ? this.abs(imgM[1]) : "",
                subTitle: "",
                tags: [],
                description: "",
            }))
        }
        return comics
    }

    // 列表分页最大页（从分页导航推断）
    parseMaxPage(html) {
        let max = 1
        let re = /\/page\/(\d+)\//g
        let m
        while ((m = re.exec(html)) !== null) {
            let n = parseInt(m[1])
            if (n > max) max = n
        }
        return max
    }

    /**
     * 通用列表加载
     * @param {string} path 归档路径，"" 表示全站最新（首页），否则形如 "/category/6/"
     * @param {number} page 1-based
     */
    async loadArchive(path, page) {
        let p = page || 1
        let url
        if (path) {
            url = p === 1 ? `${this.base}${path}` : `${this.base}${path}page/${p}/`
        } else {
            url = p === 1 ? `${this.base}/` : `${this.base}/page/${p}/`
        }
        let html = await this.fetchHtml(url)
        return { comics: this.parseList(html), maxPage: this.parseMaxPage(html) }
    }

    explore = [
        {
            title: "Hachiraw 最新",
            type: "multiPageComicList",
            load: async (page) => this.loadArchive("", page),
        },
    ]

    // 分类页：把全站题材收拢到一处，配合「探索 / 分类」两个入口
    category = {
        title: "Hachiraw 分类",
        parts: [
            {
                name: "题材",
                type: "fixed",
                categories: [
                    "全部", "动作", "成人", "冒险", "喜剧", "剧情", "色气",
                    "奇幻", "性转", "后宫", "历史", "恐怖", "成熟", "机甲",
                    "悬疑", "心理", "恋爱", "校园", "科幻", "青年", "少女",
                    "少年", "耽美", "日常", "运动",
                ],
                itemType: "category",
                // 对应 /category/<id>/；17(武侠) 与 27(百合) 站内无内容，已剔除
                categoryParams: [
                    "", "6", "7", "8", "9", "10", "11", "12", "13", "14",
                    "15", "16", "18", "19", "20", "21", "22", "23", "24",
                    "25", "26", "28", "29", "30", "31",
                ],
            },
        ],
        enableRankingPage: false,
    }

    // 点题材后进入的列表页
    categoryComics = {
        load: async (category, param, options, page) => {
            if (!param) return await this.loadArchive("", page)
            return await this.loadArchive(`/category/${param}/`, page)
        },
        optionList: [],
    }

    search = {
        // 该站服务端搜索无效，改为遍历最近列表做标题匹配
        load: async (keyword, _, page) => {
            keyword = (keyword || "").toLowerCase()
            if (!keyword) {
                return { comics: [], maxPage: 1 }
            }
            // 遍历最近若干页，收集后在本地按标题过滤
            let per = 5 // 每"搜索页"扫描 5 个列表页，兼顾速度与命中率
            let start = (page - 1) * per + 1
            let found = []
            for (let p = start; p < start + per; p++) {
                try {
                    let url = p === 1 ? this.base + "/" : `${this.base}/page/${p}/`
                    let html = await this.fetchHtml(url)
                    let comics = this.parseList(html)
                    for (let c of comics) {
                        if (c.title.toLowerCase().includes(keyword)) {
                            found.push(c)
                        }
                    }
                    // 若该页一条都没有且已到列表末尾，提前结束
                    if (comics.length === 0) break
                } catch (e) {
                    break
                }
            }
            // 只要本轮还有命中，就允许继续翻页；否则到头
            let maxPage = found.length > 0 ? page + 1 : page
            return { comics: found, maxPage: maxPage }
        },
    }

    comic = {
        loadInfo: async (id) => {
            // id 形如 /manga-xxx/
            let url = this.abs(id)
            let html = await this.fetchHtml(url)

            let titleM = html.match(/<h1[^>]*class="entry-title"[^>]*>([\s\S]*?)<\/h1>/)
            let title = this.strip(titleM ? titleM[1] : id)

            let coverM = html.match(/data-src="(https?:\/\/i\d\.hachiraw\.win\/images\/[^"]+)"/)
            if (!coverM) {
                coverM = html.match(/data-src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i)
            }
            let cover = coverM ? this.abs(coverM[1]) : ""

            // 简介：entry-content 里的正文段落
            // （跳过封面图注，以及 Author / Category / Chapter 这类元信息行）
            let desc = ""
            let block = this.contentBlock(html)
            let ps = []
            let pRe = /<p[^>]*>([\s\S]*?)<\/p>/g
            let pm
            while ((pm = pRe.exec(block)) !== null) {
                let t = this.strip(pm[1].replace(/<br\s*\/?>/gi, " "))
                if (!t) continue
                if (/^(author|writer|artist|category|chapter|status|genre|alt(ernative)?\s*title|release|serialization)\s*[:：]/i.test(t)) continue
                if (ps.indexOf(t) >= 0) continue
                ps.push(t)
            }
            desc = ps.join("\n")

            // 题材标签：只取文章内的 cat-links，避免顶部导航和"相关漫画"里的重复分类
            let tags = new Map()
            let catM = html.match(/<span[^>]*class="cat-links"[^>]*>([\s\S]*?)<\/span>/)
            let cats = []
            let seenCat = new Set()
            if (catM) {
                let catRe = /href="\/category\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/g
                let cm
                while ((cm = catRe.exec(catM[1])) !== null) {
                    let cid = cm[1]
                    if (seenCat.has(cid)) continue
                    seenCat.add(cid)
                    let label = this.genreNames[cid] || this.strip(cm[2])
                    if (label) cats.push(label)
                }
            }
            if (cats.length) tags.set("题材", cats)

            // 作者 / 连载状态（页面里是文本行，如 "Author: FUJISHIMA Kosuke"）
            let authorM = html.match(/Author\s*[:：]\s*([^<\n]{1,80})/i)
            if (authorM) {
                let author = this.strip(authorM[1])
                if (author) tags.set("作者", [author])
            }
            let lastChapter = ""
            let lcM = html.match(/>\s*(Chapter\s+\d+(?:\.\d+)?)\s*</i)
            if (lcM) lastChapter = lcM[1]

            // 章节列表：/chapter/{comicId}/{chapterId}/ + 文本 "Chapter N"
            let chapters = new Map()
            let chRe = /<a[^>]*href="\/(chapter\/(\d+)\/(\d+)\/)"[^>]*>([\s\S]*?)<\/a>/g
            let ch
            let seen = new Set()
            while ((ch = chRe.exec(html)) !== null) {
                let epPath = ch[1]            // chapter/2891/1473382/
                let epTitle = this.strip(ch[4]) || epPath
                let key = `${ch[2]}/${ch[3]}` // comicId/chapterId
                if (seen.has(key)) continue
                seen.add(key)
                chapters.set(key, epTitle)
            }

            return new ComicDetails({
                title: title,
                subtitle: lastChapter,
                cover: cover,
                description: desc,
                tags: tags,
                chapters: chapters,
                url: url,
            })
        },

        loadEp: async (comicId, epId) => {
            // comicId: /manga-xxx/ ; epId: comicId/chapterId (来自 loadInfo 的 key)
            let url = `${this.base}/chapter/${epId}/`
            let html = await this.fetchHtml(url)
            let images = []
            let imgRe = /data-src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/gi
            let m
            let seen = new Set()
            while ((m = imgRe.exec(html)) !== null) {
                let u = m[1]
                if (u.includes("/themes/") || u.includes("lazy")) continue
                let full = this.abs(u)
                if (seen.has(full)) continue
                seen.add(full)
                images.push(full)
            }
            if (images.length === 0) {
                // 兜底：data-src 无扩展名（tiktok-obj 这类）
                let imgRe2 = /data-src="(https?:\/\/[^"]+)"/g
                while ((m = imgRe2.exec(html)) !== null) {
                    let u = m[1]
                    if (u.includes("/themes/") || u.includes("lazy") || u.includes("yandex")) continue
                    let full = this.abs(u)
                    if (seen.has(full)) continue
                    seen.add(full)
                    images.push(full)
                }
            }
            return { images: images }
        },

        // 章节图片可能带防盗链，补 Referer
        onImageLoad: (url, comicId, epId) => {
            return {
                headers: {
                    "Referer": this.base + "/",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                },
            }
        },

        onThumbnailLoad: (url) => {
            return {
                headers: {
                    "Referer": this.base + "/",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                },
            }
        },

        // 支持直接粘贴漫画详情页链接
        idMatch: "hachiraw\\.win\\/(manga-[a-z0-9-]+)",

        link: {
            domains: ["hachiraw.win"],
            linkToId: (url) => {
                let m = url.match(/hachiraw\.win\/(manga-[a-z0-9-]+)/)
                return m ? "/" + m[1] + "/" : null
            },
        },
    }
}
