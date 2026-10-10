/**
 * Hachiraw (https://hachiraw.win/) 漫画源
 * 适配 Venera / VeneraX (io.github.kyosee.venera)
 *
 * 说明：
 * - 该站无可用服务端搜索（/?s= 与 /search?s= 均被忽略），
 *   因此 search 采用"拉取最新列表 + 本地标题匹配"的兜底方式；
 *   也支持直接粘贴漫画详情页链接打开。
 * - 章节图片为懒加载，真实地址在 <img data-src="...">。
 */
class Hachiraw extends ComicSource {
    name = "Hachiraw"
    key = "hachiraw"
    version = "1.0.0"
    minAppVersion = "1.6.0"
    // 本地导入时 url 仅用于标识来源；上传到源库后改回 raw 链接即可
    url = "https://hachiraw.win"

    base = "https://hachiraw.win"

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

    explore = [
        {
            title: "Hachiraw 最新",
            type: "multiPageComicList",
            load: async (page) => {
                page = page || 1
                let url = page === 1 ? this.base + "/" : `${this.base}/page/${page}/`
                let html = await this.fetchHtml(url)
                let comics = this.parseList(html)
                let maxPage = this.parseMaxPage(html)
                return { comics: comics, maxPage: maxPage }
            },
        },
    ]

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

            // 简介（entry-content 首个段落，多数为描述）
            let desc = ""
            let descM = html.match(/<div[^>]*class="entry-content"[^>]*>([\s\S]*?)<\/div>/)
            if (descM) desc = this.strip(descM[1])

            // 分类标签
            let tags = new Map()
            let catRe = /<a[^>]*href="\/category\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/g
            let cm
            let cats = []
            while ((cm = catRe.exec(html)) !== null) {
                let t = this.strip(cm[2])
                if (t) cats.push(t)
            }
            if (cats.length) tags.set("分类", cats)

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
                subtitle: "",
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
