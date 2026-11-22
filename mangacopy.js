/**
 * 拷貝漫畫 (manga-copy.com) 漫畫源
 * 適配 Venera / VeneraX (io.github.kyosee.venera)
 *
 * 站點特性（已實測）：
 * 1. 列表頁 /comics 的數據內嵌在 <div class="exemptComic-box" total="…" list="[…]">
 *    屬性裏（單引號 JS 字面量 + HTML 實體），不需要走接口。
 * 2. 搜索走 JSON 接口 /api/kb/web/searchcl/comics，匿名可用。
 * 3. 章節目錄 /comicdetail/{path_word}/chapters 與閱讀頁的 contentKey 都是
 *    「登錄後才下發」：匿名（含換 IP、換 UA、帶會話 Cookie）一律返回
 *    {"groups":{"default":{"count":0,"chapters":[]}}}，閱讀頁 contentKey 為空串。
 *    解決辦法是「帳號 → Cookie 登錄」，Cookie 只存在 App 本地數據裏，不寫進本文件。
 * 4. 章節圖片接口返回的是加密串：
 *      results / contentKey = 16 位 IV(明文字符) + hex 密文
 *      key = cct 前 16 位（cct 為全站固定鹽值，頁面內 <script> 裏有）
 *      AES-128-CBC + Pkcs7，解密後是 [{"url": "https://sn.mangafunb.fun/…"}]
 * 5. 圖片直連可下載，無 Referer 防盜鏈。
 */
class MangacopySource extends ComicSource {
    name = "拷貝漫畫"
    key = "mangacopy"
    version = "1.1.0"
    minAppVersion = "1.6.0"

    // 源更新檢測地址（改成你自己的 raw 鏈接）
    url = "https://raw.githubusercontent.com/YUIRIKIiii/venera-sources/main/mangacopy.js"

    base = "https://www.manga-copy.com"
    pageSize = 50
    // 全站固定鹽值；頁面裏出現 var cct = '…' 時會被覆蓋
    cct = "0p0zzpvv.nmn.oop"
    // 登錄 Cookie（運行時從本地數據載入，不要寫死在這裏）
    ck = ""

    get headers() {
        let h = {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9",
            "Referer": this.base + "/",
        }
        if (this.ck) h["Cookie"] = this.ck
        return h
    }

    // 讀取本地保存的 Cookie（每個入口先 await 一次，之後同步可用）
    async prepare() {
        if (!this._ckTask) {
            this._ckTask = (async () => {
                try {
                    let v = this.loadData ? this.loadData("cookie") : ""
                    if (v && typeof v.then === "function") v = await v
                    if (typeof v === "string" && v.trim()) this.ck = v.trim()
                } catch (e) { }
            })()
        }
        await this._ckTask
    }

    async getText(url) {
        let res = await Network.get(url, this.headers)
        if (res.status !== 200) {
            throw `請求失敗 ${res.status}: ${url}`
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
            .replace(/&#x27;|&#39;|&apos;/g, "'")
            .replace(/&#x22;|&quot;/g, '"')
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
    }

    strip(s) {
        return this.decode((s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    }

    // "1234.5W" / "1.2億" → 數字
    toNumber(txt) {
        let m = String(txt || "").match(/([\d.]+)\s*(萬|万|W|億|亿|E)?/i)
        if (!m) return 0
        let n = parseFloat(m[1])
        let unit = m[2]
        if (unit === "萬" || unit === "万" || unit === "W" || unit === "w") n *= 10000
        else if (unit === "億" || unit === "亿" || unit === "E") n *= 100000000
        return Math.round(n)
    }

    /* ---------------- 加解密 ---------------- */

    hexToBuf(hex) {
        let len = hex.length >> 1
        let buf = new ArrayBuffer(len)
        let view = new Uint8Array(buf)
        for (let i = 0; i < len; i++) {
            view[i] = parseInt(hex.substr(i * 2, 2), 16)
        }
        return buf
    }

    /**
     * 解密站點返回的 blob：16 位明文 IV + hex 密文
     */
    decryptBlob(blob) {
        let s = String(blob || "")
        if (s.length < 32) throw "加密串長度異常"
        let iv = s.substring(0, 16)
        let ct = s.substring(16)
        let plainBuf = Convert.decryptAesCbc(
            this.hexToBuf(ct),
            Convert.encodeUtf8(this.cct.substring(0, 16)),
            Convert.encodeUtf8(iv)
        )
        let text = Convert.decodeUtf8(plainBuf)
        // 部分實現不會去掉 PKCS7 填充，去掉尾部控制字符即可
        return text.replace(/[\u0000-\u001f]+$/g, "")
    }

    /* ---------------- 列表 ---------------- */

    /**
     * 把站点内嵌的「单引号 JS 字面量」转成合法 JSON
     * [{&#x27;k&#x27;: &#x27;v&#x27;}] → [{"k": "v"}]
     */
    jsLitToJson(src) {
        let out = ""
        let i = 0
        while (i < src.length) {
            let ch = src[i]
            if (ch === "'" || ch === '"') {
                let quote = ch
                let j = i + 1
                let buf = ""
                while (j < src.length) {
                    let c = src[j]
                    if (c === "\\") {
                        buf += c + (src[j + 1] || "")
                        j += 2
                        continue
                    }
                    if (c === quote) break
                    buf += c
                    j++
                }
                out += '"' + buf.replace(/"/g, '\\"') + '"'
                i = j + 1
            } else {
                out += ch
                i++
            }
        }
        return out
    }

    parseListAttr(html) {
        let m = html.match(/class="[^"]*exemptComic-box[^"]*"[^>]*/)
        if (!m) return { total: 0, items: [] }
        let tag = m[0]
        let totalM = tag.match(/total="(\d+)"/)
        let listM = tag.match(/list="([\s\S]*?)"\s*(?:>|$)/)
        if (!listM) return { total: totalM ? parseInt(totalM[1]) : 0, items: [] }
        let raw = this.decode(listM[1])
        let items = []
        try {
            items = JSON.parse(this.jsLitToJson(raw))
        } catch (e) {
            items = this.parseItemsByRegex(raw)
        }
        return { total: totalM ? parseInt(totalM[1]) : 0, items: items }
    }

    // JSON 化失败时的兜底：按对象块逐条取字段
    parseItemsByRegex(raw) {
        let items = []
        let blocks = raw.split(/\}\s*,\s*\{/)
        for (let b of blocks) {
            let id = b.match(/'path_word'\s*:\s*'([^']*)'/)
            if (!id) continue
            let name = b.match(/'name'\s*:\s*'([^']*)'/)
            let cover = b.match(/'cover'\s*:\s*'([^']*)'/)
            let author = b.match(/'author'\s*:\s*\[\s*\{\s*'name'\s*:\s*'([^']*)'/)
            items.push({
                path_word: id[1],
                name: name ? name[1] : id[1],
                cover: cover ? cover[1] : "",
                author: author ? [{ name: author[1] }] : [],
            })
        }
        return items
    }

    /**
     * 分類列表
     * @param {{theme?:string, ordering?:string, region?:string}} p
     * @param {number} page 1-based
     */
    async loadList(p, page) {
        await this.prepare()
        let n = page && page > 0 ? page : 1
        let theme = (p && p.theme) || ""
        let ordering = (p && p.ordering) || "-datetime_updated"
        let offset = (n - 1) * this.pageSize
        let url = `${this.base}/comics?ordering=${ordering}&offset=${offset}&limit=${this.pageSize}`
        if (theme) url += `&theme=${theme}`
        let html = await this.getText(url)
        let { total, items } = this.parseListAttr(html)

        let comics = []
        for (let it of items) {
            if (!it || !it.path_word) continue
            let author = ""
            if (it.author && it.author.length > 0) {
                author = it.author.map((a) => this.decode(a.name || "")).filter((x) => x).join(" / ")
            }
            comics.push(
                new Comic({
                    id: it.path_word,
                    title: this.decode(it.name || it.path_word),
                    cover: it.cover || "",
                    subTitle: author,
                    tags: [],
                    description: "",
                })
            )
        }
        let maxPage = total > 0 ? Math.ceil(total / this.pageSize) : n + (comics.length > 0 ? 1 : 0)
        return { comics: comics, maxPage: maxPage }
    }

    explore = [
        {
            title: "最新更新",
            type: "multiPageComicList",
            load: async (page) => this.loadList({}, page),
        },
        {
            title: "熱門",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ ordering: "-popular" }, page),
        },
        {
            title: "愛情",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ theme: "aiqing" }, page),
        },
        {
            title: "奇幻",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ theme: "qihuan" }, page),
        },
        {
            title: "校園",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ theme: "xiaoyuan" }, page),
        },
        {
            title: "搞笑",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ theme: "gaoxiao" }, page),
        },
        {
            title: "格鬥",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ theme: "gedou" }, page),
        },
        {
            title: "穿越",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ theme: "chuanyue" }, page),
        },
        {
            title: "異世界",
            type: "multiPageComicList",
            load: async (page) => this.loadList({ theme: "yishijie" }, page),
        },
    ]

    search = {
        load: async (keyword, _, page) => {
            await this.prepare()
            let kw = (keyword || "").trim()
            if (!kw) return { comics: [], maxPage: 1 }
            let n = page && page > 0 ? page : 1
            let limit = 12
            let offset = (n - 1) * limit
            let url =
                `${this.base}/api/kb/web/searchcl/comics?offset=${offset}` +
                `&platform=2&limit=${limit}&q=${encodeURIComponent(kw)}&q_type=`
            let data = await this.getJson(url)
            let results = (data && data.results) || {}
            let list = results.list || []
            let total = results.total || 0
            let comics = []
            for (let it of list) {
                if (!it || !it.path_word) continue
                let author = ""
                if (it.author && it.author.length > 0) {
                    author = it.author.map((a) => this.decode(a.name || "")).filter((x) => x).join(" / ")
                }
                comics.push(
                    new Comic({
                        id: it.path_word,
                        title: this.decode(it.name || it.path_word),
                        cover: it.cover || "",
                        subTitle: author,
                        tags: (it.theme || []).map((t) => this.decode(t)),
                        description: "",
                    })
                )
            }
            let maxPage = total > 0 ? Math.ceil(total / limit) : n + (comics.length > 0 ? 1 : 0)
            return { comics: comics, maxPage: maxPage }
        },
    }

    /* ---------------- 详情 ---------------- */

    normalizeId(id) {
        let s = String(id || "")
        let m = s.match(/manga-copy\.com\/comic\/([^\/?#]+)/)
        if (m) return m[1]
        s = s.replace(/^\/+|\/+$/g, "")
        return s.replace(/^comic\//, "").split("?")[0]
    }

    // 取 <span>標籤：</span> 后面的兄弟节点文本
    field(html, label) {
        let re = new RegExp(
            "<span[^>]*>\\s*" + label + "：?\\s*</span>([\\s\\S]{0,400}?)</li>"
        )
        let m = html.match(re)
        if (!m) return ""
        return this.strip(m[1])
    }

    async loadChapters(cid) {
        let chapters = new Map()
        let url = `${this.base}/comicdetail/${cid}/chapters`
        let data
        try {
            data = await this.getJson(url)
        } catch (e) {
            return chapters
        }
        if (!data || !data.results) return chapters
        let parsed
        try {
            parsed = JSON.parse(this.decryptBlob(data.results))
        } catch (e) {
            return chapters
        }
        let groups = parsed.groups || {}
        let seq = []
        let pos = 0
        for (let gk in groups) {
            let g = groups[gk] || {}
            let arr = g.chapters || []
            for (let c of arr) {
                let id = c.uuid || c.id || c.path_word || c.chapter_uuid || ""
                if (!id) continue
                let name = this.strip(c.name || c.title || "")
                seq.push({
                    id: String(id),
                    name: name || String(id),
                    index: typeof c.index === "number" ? c.index : null,
                    pos: pos++,
                })
            }
        }
        if (seq.length === 0) return chapters

        // 指定 index 就按 index 排；否则按标题里的数字排；都不行就保持接口顺序
        let allIndex = seq.every((x) => x.index !== null)
        let numOf = (x) => {
            let m = x.name.match(/(\d+(?:\.\d+)?)/)
            return m ? parseFloat(m[1]) : null
        }
        let allNum = seq.every((x) => numOf(x) !== null)
        if (allIndex) {
            seq.sort((a, b) => a.index - b.index)
        } else if (allNum) {
            seq.sort((a, b) => numOf(a) - numOf(b))
        }
        for (let c of seq) {
            if (!chapters.has(c.id)) chapters.set(c.id, c.name)
        }
        return chapters
    }

    /* ---------------- 帳號（Cookie 登錄） ---------------- */

    // 探針：登錄成功後章節接口才會返回非空數組
    async probeLogin() {
        let html = await this.getText(`${this.base}/comics?limit=1`)
        let { items } = this.parseListAttr(html)
        let pw = (items[0] && items[0].path_word) || "naoodngxueshenghui"
        let data = await this.getJson(`${this.base}/comicdetail/${pw}/chapters`)
        let parsed = JSON.parse(this.decryptBlob(data.results))
        let groups = parsed.groups || {}
        for (let k in groups) {
            if ((groups[k].chapters || []).length > 0) return true
        }
        return false
    }

    account = {
        /*
         * 站點匿名狀態下：章節列表 0 條、閱讀頁 contentKey 空串。
         * 在瀏覽器登錄後，開發者工具 → Application → Cookies → www.manga-copy.com，
         * 把 token（以及 member 等）拼成 "token=xxx; member=1" 粘進來即可。
         * 只填 token 的值也認（會自動補成 token=…）。
         */
        loginWithCookies: {
            fields: ["Cookie"],
            validate: async (values) => {
                let raw = String((values && values[0]) || "").trim()
                if (!raw) return false
                if (raw.indexOf("=") < 0) raw = "token=" + raw
                let backup = this.ck
                this.ck = raw
                try {
                    let ok = await this.probeLogin()
                    if (!ok) {
                        this.ck = backup
                        return false
                    }
                    this.saveData("cookie", raw)
                    return true
                } catch (e) {
                    this.ck = backup
                    return false
                }
            },
        },
        logout: () => {
            this.ck = ""
            this.saveData("cookie", "")
        },
        registerWebsite: "https://www.manga-copy.com/register",
    }

    comic = {
        loadInfo: async (id) => {
            await this.prepare()
            let cid = this.normalizeId(id)
            let url = `${this.base}/comic/${cid}`
            let html = await this.getText(url)

            let titleM = html.match(/<h6[^>]*title="([^"]*)"/)
            let title = titleM ? this.decode(titleM[1]) : cid
            let coverM = html.match(
                /comicParticulars-left-img[\s\S]{0,200}?data-src="([^"]+)"/
            )
            let cover = coverM ? coverM[1] : ""
            let author = this.field(html, "作者")
            let status = this.field(html, "狀態")
            let alias = this.field(html, "別名")
            let hot = this.field(html, "熱度")
            let updateTime = this.field(html, "最後更新")

            let descM = html.match(/<p class="intro"[^>]*>([\s\S]*?)<\/p>/)
            let description = descM ? this.strip(descM[1]) : ""

            let tags = new Map()
            let themes = []
            let themeBlock = html.match(/題材：<\/span>([\s\S]{0,600}?)<\/li>/)
            if (themeBlock) {
                let re = /#([^<]+)<\/a>/g
                let m
                while ((m = re.exec(themeBlock[1])) !== null) {
                    themes.push(this.decode(m[1]).trim())
                }
            }
            if (themes.length > 0) tags.set("題材", themes)
            if (author) tags.set("作者", author.split(/\s*\/\s*/).filter((x) => x))
            if (alias) tags.set("別名", alias.split(/[,，]/).map((x) => x.trim()).filter((x) => x))

            let chapters = await this.loadChapters(cid)
            if (chapters.size === 0) {
                // 匿名兜底：詳情頁只有「開始閱讀」一個章節連結
                let firstM = html.match(
                    /href="\/comic\/[^"]+\/chapter\/([0-9a-f\-]{16,})"/
                )
                if (firstM) chapters.set(firstM[1], "開始閱讀")
                tags.set("提示", ["章節目錄需登錄，見 帳號 → Cookie 登錄"])
            }

            return new ComicDetails({
                title: title,
                subtitle: status,
                cover: cover,
                description: description,
                tags: tags,
                chapters: chapters,
                updateTime: updateTime,
                uploadTime: updateTime,
                stars: hot ? Math.min(5, Math.log10(this.toNumber(hot) + 1) / 2) : null,
                url: url,
            })
        },

        loadEp: async (comicId, epId) => {
            await this.prepare()
            let cid = this.normalizeId(comicId)
            let url = `${this.base}/comic/${cid}/chapter/${epId}`
            let html = await this.getText(url)

            let cctM = html.match(/var cct = '([^']+)'/)
            if (cctM) this.cct = cctM[1]

            let ckM = html.match(/var contentKey = '([^']*)'/)
            let contentKey = ckM ? ckM[1] : ""
            if (!contentKey) {
                throw (
                    "該章節沒有下發圖片密鑰（contentKey 為空）。\n" +
                    "站點要求登錄後才給密鑰：請在 漫畫源 → 拷貝漫畫 → 帳號 裏用 Cookie 登錄，" +
                    "再重新打開本章。"
                )
            }

            let plain = this.decryptBlob(contentKey)
            let list
            try {
                list = JSON.parse(plain)
            } catch (e) {
                throw "圖片數據解密後不是合法 JSON，站點可能已改版"
            }
            let images = []
            let seen = new Set()
            for (let it of list) {
                let u = typeof it === "string" ? it : it && (it.url || it.path)
                if (!u) continue
                if (!/^https?:\/\//.test(u)) u = "https://" + u.replace(/^\/+/, "")
                if (seen.has(u)) continue
                seen.add(u)
                images.push(u)
            }
            if (images.length === 0) {
                throw `未解析到圖片: ${url}`
            }
            return { images: images }
        },

        // 支持直接粘貼詳情頁鏈接
        idMatch: "manga-copy\\.com\\/comic\\/([a-zA-Z0-9\\-_]+)",
        link: {
            domains: ["www.manga-copy.com", "manga-copy.com", "m.manga-copy.com"],
            linkToId: (url) => {
                let m = String(url).match(/manga-copy\.com\/comic\/([^\/?#]+)/)
                return m ? m[1] : null
            },
        },
    }
}
