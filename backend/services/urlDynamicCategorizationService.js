/**
 * URL Dynamic Categorization Service
 * Optimized + Aggressive caching + Safe improvements
 */

class URLDynamicCategorizationService {
    constructor(options = {}) {
        // Tunable knobs
        this.fuzzyThreshold = options.fuzzyThreshold ?? 88; // similarity %
        this.fuzzyLengthDelta = options.fuzzyLengthDelta ?? 3; // max len diff for fuzzy
        this.maxKeywordsForScoring = options.maxKeywordsForScoring ?? 12;

        // Persistent caches
        this.keywordSynonymCache = null;
        this.synonymLookupCache = null;
        this.categoryKeywordMapCache = null;
        this.categoryKeywordSets = null;
        this.technicalPatternCache = null;
        this.stopWordsCache = null;

        // Runtime caches (per instance)
        this.runtime = {
            keywordCache: new Map(),   // url/path -> [keywords]
            fuzzyCache: new Map(),     // "a|b" -> similarity
            structuralSignals: null,   // path -> score
            treeCache: null           // last tree
        };

        // Generic keywords that are down-weighted
        this.genericKeywords = new Set([
            'info','information','details','page','pages','section','sections','new','latest',
            'help','support','service','services','store','brand','brands','guide','guides',
            'more','overview','general'
        ]);
    }

    clearRuntimeCaches() {
        this.runtime.keywordCache.clear();
        this.runtime.fuzzyCache.clear();
        this.runtime.structuralSignals = null;
        this.runtime.treeCache = null;
    }

    safeDecodeURIComponent(value) {
        if (typeof value !== 'string') return '';
        try {
            return decodeURIComponent(value);
        } catch {
            return value;
        }
    }

    getStopWords() {
        if (!this.stopWordsCache) {
            this.stopWordsCache = new Set([
                'a','an','the','and','or','for','to','in','of','by','on','at','it','is','be',
                'with','from','as','that','this','are','you','your','our','we'
            ]);
        }
        return this.stopWordsCache;
    }

    getTechnicalPatterns() {
        if (!this.technicalPatternCache) {
            this.technicalPatternCache = [
                /^\/api\//i,
                /^\/v\d+\//i,
                /^\/assets\//i,
                /^\/static\//i,
                /^\/public\//i,
                /^\/images\//i,
                /^\/fonts\//i,
                /^\/css\//i,
                /^\/js\//i,
                /^\/dist\//i,
                /^\/__next\//i,
                /^\/.well-known\//i,
                /\.min\.(js|css)$/i,
                /^\/.env/i,
                /^\/.git/i,
                /^\/node_modules\//i,
                /^\/bundle\//i,
                /^\/app\.(js|css)$/i,
                /^\/favicon/i,
                /^\/robots\.txt/i,
                /^\/sitemap/i
            ];
        }
        return this.technicalPatternCache;
    }

    /* ------------------ Levenshtein & fuzzy ------------------ */

    levenshteinDistance(a = '', b = '', maxAllowed = Infinity) {
        if (a === b) return 0;
        if (!a.length) return b.length;
        if (!b.length) return a.length;

        if (a.length > b.length) [a, b] = [b, a];

        const prevRow = new Array(a.length + 1);
        for (let i = 0; i <= a.length; i++) prevRow[i] = i;

        for (let i = 1; i <= b.length; i++) {
            let curRow0 = i;
            for (let j = 1; j <= a.length; j++) {
                const insertCost = prevRow[j] + 1;
                const deleteCost = curRow0 + 1;
                const replaceCost = prevRow[j - 1] + (a[j - 1] === b[i - 1] ? 0 : 1);
                const newVal = Math.min(insertCost, deleteCost, replaceCost);
                prevRow[j - 1] = curRow0;
                curRow0 = newVal;
            }
            prevRow[a.length] = curRow0;
            if (maxAllowed !== Infinity && Math.min(...prevRow) > maxAllowed) return Infinity;
        }
        return prevRow[a.length];
    }

    calculateStringSimilarityCached(a, b) {
        if (!a || !b) return 0;
        if (a === b) return 100;
        const key = `${a}|${b}`;
        const revKey = `${b}|${a}`;
        if (this.runtime.fuzzyCache.has(key)) return this.runtime.fuzzyCache.get(key);
        if (this.runtime.fuzzyCache.has(revKey)) return this.runtime.fuzzyCache.get(revKey);

        if (Math.abs(a.length - b.length) > this.fuzzyLengthDelta + 2) {
            this.runtime.fuzzyCache.set(key, 0);
            return 0;
        }

        const dist = this.levenshteinDistance(a, b);
        const maxLen = Math.max(a.length, b.length);
        const sim = maxLen === 0 ? 100 : Math.max(0, 100 - (dist / maxLen) * 100);
        this.runtime.fuzzyCache.set(key, sim);
        return sim;
    }

    areSimilarKeywordsGuarded(kw1, kw2, threshold = this.fuzzyThreshold) {
        if (!kw1 || !kw2) return false;
        if (kw1 === kw2) return true;
        if (Math.abs(kw1.length - kw2.length) > this.fuzzyLengthDelta) return false;
        if (kw1.length <= 2 || kw2.length <= 2) return false;
        const sim = this.calculateStringSimilarityCached(kw1, kw2);
        return sim >= threshold;
    }

    /* ------------------ Synonyms & category sets ------------------ */

    getKeywordSynonyms() {
        // This will get overridden with expanded map in Part 3,
        // but we keep a base version here so class works even before extension.
        if (!this.keywordSynonymCache) {
            const map = {
                products: ['product','prod','items','goods','merchandise','sku','item'],
                shop: ['store','shopping','purchase','buy','shop'],
                profile: ['account','user','my-account','my-profile','profile','profile-settings'],
                help: ['support','assistance','aid','help','help-center','helpdesk'],
                payment: ['billing','checkout','transaction','invoice','pay','payments','card'],
                booking: ['book','reservation','reserve','booking','bookings','reservations'],
                order: ['orders','purchase','buy','order-history','order'],
                guide: ['tutorial','how-to','howto','guides','guide'],
                sale: ['discount','offer','promo','promotion','sale','clearance','deal'],
                contact: ['support','help','email','messaging','contact','contact-us'],
                auth: ['login','signin','signup','register','logout','authenticate','auth'],
                cart: ['cart','basket','checkout','bag','shopping-cart']
            };
            Object.keys(map).forEach(k => {
                map[k] = Array.from(new Set(map[k].map(s => s.toLowerCase())));
            });
            this.keywordSynonymCache = map;
        }
        return this.keywordSynonymCache;
    }

    getSynonymLookup() {
        if (!this.synonymLookupCache) {
            const synonyms = this.getKeywordSynonyms();
            const lookup = new Map();
            for (const [canonical, list] of Object.entries(synonyms)) {
                lookup.set(canonical.toLowerCase(), canonical.toLowerCase());
                for (const v of list) lookup.set(v.toLowerCase(), canonical.toLowerCase());
            }
            this.synonymLookupCache = lookup;
        }
        return this.synonymLookupCache;
    }

    prepareCategoryKeywordSets() {
        if (this.categoryKeywordSets) return this.categoryKeywordSets;
        const map = this.getCategoryKeywordMap();
        const out = {};
        for (const [name, data] of Object.entries(map)) {
            const keys = (Array.isArray(data.keywords) ? data.keywords : []).map(k => String(k).toLowerCase());
            out[name] = {
                keywords: keys,
                keywordSet: new Set(keys),
                score: data.score || 1
            };
        }
        this.categoryKeywordSets = out;
        return this.categoryKeywordSets;
    }

    /* ------------------ Path & keyword extraction ------------------ */

    normalizePath(url) {
        let path = url;
        if (!path || typeof path !== 'string') return '/';
        if (url.includes('://')) {
            try {
                const u = new URL(url);
                path = u.pathname || '/';
            } catch {
                // ignore
            }
        }
        const q = path.indexOf('?');
        if (q >= 0) path = path.slice(0, q);
        const h = path.indexOf('#');
        if (h >= 0) path = path.slice(0, h);
        if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
        if (!path.startsWith('/')) path = '/' + path;
        return path || '/';
    }

    extractKeywordsFromPathCached(pathOrUrl) {
        const cacheKey = pathOrUrl || '/';
        if (this.runtime.keywordCache.has(cacheKey)) return this.runtime.keywordCache.get(cacheKey);

        const path = (cacheKey.includes('://') || !cacheKey.startsWith('/'))
            ? this.normalizePath(cacheKey)
            : cacheKey;

        const stop = this.getStopWords();
        const tokens = [];
        const segments = path.split('/').filter(Boolean);

        segments.forEach((seg, segIndex) => {
            seg = this.safeDecodeURIComponent(seg || '').trim();
            if (!seg) return;

            seg = seg.replace(/([a-z])([A-Z])/g, '$1 $2'); // camelCase split
            const parts = seg.split(/[\s\-\_\.\+]+/).filter(Boolean);

            for (let p of parts) {
                const cleaned = p.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!cleaned) continue;
                if (/^\d+$/.test(cleaned)) continue;
                if (cleaned.length <= 2 && stop.has(cleaned)) continue;

                // Light position weighting: prioritize deeper segments slightly
                // by pushing them earlier (so they are more likely to be counted first)
                if (segIndex >= 2) {
                    tokens.unshift(cleaned);
                } else {
                    tokens.push(cleaned);
                }

                if (tokens.length >= this.maxKeywordsForScoring) break;
            }
        });

        this.runtime.keywordCache.set(cacheKey, tokens);
        return tokens;
    }

    extractKeywords(url) {
        return this.extractKeywordsFromPathCached(url);
    }
}
/**
 * Part 2 – Attach tree, domain, matching, confidence & orchestration
 */

Object.assign(URLDynamicCategorizationService.prototype, {

    /* --------- Tree + structural signals (depth-aware) --------- */

    buildURLTree(urls = []) {
        const tree = {};
        tree[''] = { depth: 0, children: [], urls: [], segment: '', parent: null, keywords: new Set() };

        for (const url of urls) {
            const path = this.normalizePath(url);
            if (path === '/' || path === '') {
                tree[''].urls.push(url);
                continue;
            }

            const segments = path.split('/').filter(Boolean);
            let current = '';
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                current = current + '/' + seg;

                if (!tree[current]) {
                    tree[current] = {
                        depth: i + 1,
                        segment: seg,
                        parent: i === 0 ? '' : '/' + segments.slice(0, i).join('/'),
                        children: [],
                        urls: [],
                        keywords: new Set()
                    };
                }
            }

            if (tree[current]) tree[current].urls.push(url);
        }

        for (const [path, node] of Object.entries(tree)) {
            if (node.parent !== undefined && node.parent !== null) {
                const parent = tree[node.parent];
                if (parent && !parent.children.includes(path)) parent.children.push(path);
            }
        }

        this.runtime.treeCache = tree;
        return tree;
    },

    analyzeTreePatterns(tree) {
        const patterns = {
            depth1Paths: [],
            pathsWithManyChildren: [],
            productPatterns: [],
            accountPatterns: [],
            paymentPatterns: [],
            singleSegmentPaths: []
        };

        for (const [path, node] of Object.entries(tree)) {
            if (!path) continue;

            const segments = path.split('/').filter(Boolean);

            if (node.depth === 1) {
                patterns.depth1Paths.push({
                    path,
                    segment: segments[0],
                    childCount: node.children.length,
                    urlCount: node.urls.length
                });
            }

            if (node.children && node.children.length >= 2) {
                patterns.pathsWithManyChildren.push({
                    path,
                    childCount: node.children.length,
                    children: node.children
                });
            }

            const seg = segments[segments.length - 1]?.toLowerCase() || '';

            if (['p','products','shop','store','catalog','category','collection','browse']
                .includes(seg)) patterns.productPatterns.push(path);

            if (['account','profile','user','dashboard','settings','my-account']
                .includes(seg)) patterns.accountPatterns.push(path);

            if (['payment','billing','checkout','cart','transaction']
                .includes(seg)) patterns.paymentPatterns.push(path);

            if (segments.length === 1) patterns.singleSegmentPaths.push(path);
        }

        return patterns;
    },

    computeStructuralSignals(tree) {
        if (this.runtime.structuralSignals) return this.runtime.structuralSignals;

        const signals = {};

        for (const [path, node] of Object.entries(tree)) {
            const childCount = node.children?.length || 0;
            const urlCount = node.urls?.length || 0;

            const base = (childCount + Math.min(urlCount, 5)) / 5;
            const depthBoost = Math.min(node.depth * 0.08, 0.4);

            signals[path] = Math.min(1, base + depthBoost);
        }

        this.runtime.structuralSignals = signals;
        return signals;
    },

    /* ---------------- Domain detection ---------------- */

    detectDomainType(patterns, tree) {
        const analysis = {
            ecommerce: 0,
            travel: 0,
            banking: 0,
            health: 0,
            utility: 0,
            subscription: 0,
            education: 0,
            media: 0
        };

        const pathList = Object.keys(tree).map(p => p.toLowerCase());
        const containsKeyword = keywords =>
            pathList.some(p => keywords.some(kw => p.includes(kw)));

        if (patterns.productPatterns.length > 0 || patterns.pathsWithManyChildren.length > 2)
            analysis.ecommerce += 3;

        if (containsKeyword(['cart','checkout','product','shop','store','collection']))
            analysis.ecommerce += 2;

        if (containsKeyword(['flight','hotel','booking','reservation','trip','travel']))
            analysis.travel += 3;

        if (containsKeyword(['billing','payment','transaction','card']))
            analysis.banking += 2;

        if (containsKeyword(['health','pharmacy','medical','doctor']))
            analysis.health += 3;

        if (containsKeyword(['plan','subscription','pricing','subscribe']))
            analysis.subscription += 2;

        if (containsKeyword(['course','academy','training']))
            analysis.education += 2;

        if (containsKeyword(['news','blog','press','media']))
            analysis.media += 1.5;

        const entries = Object.entries(analysis);

        const { type: dominantType, score: dominantScore } = entries.reduce(
            (acc, [type, score]) =>
                score > acc.score ? { type, score } : acc,
            { type: 'unknown', score: 0 }
        );

        const totalScore = entries.reduce((s, [,v]) => s + v, 0);

        return {
            type: dominantScore === 0 ? 'unknown' : dominantType,
            scores: analysis,
            confidence: totalScore > 0 ? Number((dominantScore / totalScore).toFixed(2)) : 0
        };
    },

    getCategoryDomainHint(categoryName = '') {
        const map = {
            'Product Categories': 'ecommerce',
            'Offers & Sales': 'ecommerce',
            'Payment & Financial': 'banking',
            'Account & User Functions': 'subscription',
            'Account Management': 'subscription',
            'Booking & Reservations': 'travel',
            'Booking – Travel Specific': 'travel',
            'Health & Pharmacy Services': 'health',
            'Guides & Educational Content': 'education',
            'FAQ / Knowledgebase': 'education',
            'News & Information': 'media',
            'Media / Gallery': 'media',
            'Subscription & Pricing': 'subscription',
        };
        return map[categoryName] || null;
    },

    calculateDomainAlignment(categoryName, domainType) {
        const hint = this.getCategoryDomainHint(categoryName);
        if (!hint) return 0;

        if (domainType.type === hint && domainType.confidence > 0)
            return Math.min(1, 0.5 + domainType.confidence / 2);

        const hintScore = domainType.scores?.[hint] || 0;
        const totalScore = Object.values(domainType.scores).reduce((a,b) => a+b, 0);

        return totalScore ? Number((hintScore / totalScore).toFixed(2)) : 0;
    },

    /* ---------------- Keyword match scoring ---------------- */

    calculateKeywordMatchScoreFast(urlKeywords, category) {
        if (!urlKeywords?.length) return { score: 0, matches: [], matchCount: 0 };

        const unique = Array.from(new Set(urlKeywords.map(k => k.toLowerCase())));
        const matches = new Set();
        const synonymLookup = this.getSynonymLookup();
        const genericHits = new Set();

        for (const kw of unique) {
            const u = kw.toLowerCase();

            if (category.keywordSet.has(u)) {
                matches.add(u);
                if (this.genericKeywords.has(u)) genericHits.add(u);
                continue;
            }

            const canonical = synonymLookup.get(u);
            if (canonical && category.keywordSet.has(canonical)) {
                matches.add(canonical);
                if (this.genericKeywords.has(canonical)) genericHits.add(canonical);
                continue;
            }

            if (u.length <= 2) continue;

            for (const catKw of category.keywords) {
                if (Math.abs(catKw.length - u.length) > this.fuzzyLengthDelta) continue;
                if (this.areSimilarKeywordsGuarded(u, catKw)) {
                    matches.add(catKw);
                    if (this.genericKeywords.has(catKw)) genericHits.add(catKw);
                    break;
                }
            }
        }

        if (!matches.size) return { score: 0, matches: [], matchCount: 0 };

        let score = (matches.size / unique.length) * 100;

        if (genericHits.size === matches.size) score *= 0.55;
        else if (genericHits.size > 0) score *= 0.8;

        return {
            score,
            matches: Array.from(matches),
            matchCount: matches.size
        };
    },

    matchKeywordsToCategory(keywords) {
        const categorySets = this.prepareCategoryKeywordSets();

        let best = {
            category: 'Other',
            score: 0,
            matchCount: 0,
            matches: [],
            weightedScore: 0
        };

        for (const [catName, catData] of Object.entries(categorySets)) {
            const m = this.calculateKeywordMatchScoreFast(keywords, catData);
            const w = m.score * (catData.score / 10);

            if (w > best.weightedScore ||
                (w === best.weightedScore && m.matchCount > best.matchCount)) {
                best = { ...m, weightedScore: w, category: catName };
            }
        }

        return best.weightedScore >= 10 ? best : { ...best, category: 'Other' };
    },

    /* ---------------- Confidence scoring ---------------- */

    calculateConfidence(f) {
        const k = ((f.keywordScore / 100) * (0.5 + Math.min(f.matchCount / 3, 0.5)));
        const s = f.structuralSignal;
        const d = f.domainAlignment;
        const p = f.parentStrength;

        const conf = Math.min(1,
            k * 0.45 +
            s * 0.30 +
            d * 0.15 +
            p * 0.10
        );

        return {
            confidence: conf,
            breakdown: {
                keywordComponent: Number(k.toFixed(3)),
                structuralComponent: Number(s.toFixed(3)),
                domainComponent: Number(d.toFixed(3)),
                parentComponent: Number(p.toFixed(3))
            }
        };
    },

    /* ---------------- Pattern overrides ---------------- */

    getPatternOverrideCategory(path) {
        const p = path.toLowerCase();

        if (p === '/' || p === '') return null;

        if (/(^|\/)(about|about-us)(\/|$)/.test(p)) return 'About / Company';
        if (/(^|\/)(contact|contact-us|get-in-touch)(\/|$)/.test(p)) return 'Contact & Support';
        if (/(^|\/)(support|help-center|helpdesk)(\/|$)/.test(p)) return 'Contact & Support';
        if (/(^|\/)(faq|faqs)(\/|$)/.test(p)) return 'FAQ / Knowledgebase';
        if (/(^|\/)(terms|privacy|legal|cookie-policy)(\/|$)/.test(p)) return 'Legal & Compliance';
        if (/(^|\/)(sitemap|site-map)(\/|$)/.test(p)) return 'Sitemap';
        if (/(^|\/)(blog|news|press)(\/|$)/.test(p)) return 'News & Information';
        if (/(^|\/)(careers|jobs|join-us)(\/|$)/.test(p)) return 'Careers & Jobs';

        return null;
    },

    /* ---------------- Find Best Category (Full Reasoning) ---------------- */

    findBestCategorySmartly(url, context) {
        const path = this.normalizePath(url);

        const tree = context.tree;
        const patterns = context.patterns;
        const domainType = context.domainType;
        const structuralSignals = context.signals;

        const keywords = context.keywordCache.get(url) || [];

        const node = tree[path];
        const structuralSignal = node
            ? (structuralSignals[path] || structuralSignals[node.parent] || 0.4)
            : 0;

        const results = [];

        // 0. High precision override
        const override = this.getPatternOverrideCategory(path);
        if (override) {
            const conf = this.calculateConfidence({
                keywordScore: 90,
                matchCount: 1,
                structuralSignal: Math.max(structuralSignal, 0.6),
                domainAlignment: this.calculateDomainAlignment(override, domainType),
                parentStrength: 0
            });

            return {
                category: override,
                confidence: conf.confidence,
                reason: `Pattern-based override for "${path}"`,
                signal: 'pattern_override',
                confidenceBreakdown: conf.breakdown,
                alternatives: []
            };
        }

        // 1. Structural patterns
        if (patterns.productPatterns.includes(path)) {
            const conf = this.calculateConfidence({
                keywordScore: 100,
                matchCount: 1,
                structuralSignal: 0.95,
                domainAlignment: domainType.type === 'ecommerce' ? 1 : 0.6,
                parentStrength: 0
            });

            return {
                category: 'Product Categories',
                confidence: conf.confidence,
                reason: 'Product structural match',
                signal: 'structural',
                confidenceBreakdown: conf.breakdown,
                alternatives: []
            };
        }

        if (patterns.accountPatterns.includes(path)) {
            const conf = this.calculateConfidence({
                keywordScore: 100,
                matchCount: 1,
                structuralSignal: 0.95,
                domainAlignment: 0.5,
                parentStrength: 0
            });

            return {
                category: 'Account & User Functions',
                confidence: conf.confidence,
                reason: 'Account structural match',
                signal: 'structural',
                confidenceBreakdown: conf.breakdown,
                alternatives: []
            };
        }

        if (patterns.paymentPatterns.includes(path)) {
            const conf = this.calculateConfidence({
                keywordScore: 100,
                matchCount: 1,
                structuralSignal: 0.95,
                domainAlignment: 0.6,
                parentStrength: 0
            });

            return {
                category: 'Payment & Financial',
                confidence: conf.confidence,
                reason: 'Payment structural match',
                signal: 'structural',
                confidenceBreakdown: conf.breakdown,
                alternatives: []
            };
        }

        // 2. Parent reasoning
        let parentStrength = 0;
        const parentPath = this.getParentPath(path);

        if (parentPath && tree[parentPath] && tree[parentPath].children.length >= 2) {
            const pKeywords = context.keywordCache.get(parentPath) || [];
            const pm = this.matchKeywordsToCategory(pKeywords);

            if (pm.category !== 'Other') {
                const pConf = this.calculateConfidence({
                    keywordScore: pm.weightedScore,
                    matchCount: pm.matchCount,
                    structuralSignal: tree[parentPath].children.length / 5,
                    domainAlignment: this.calculateDomainAlignment(pm.category, domainType),
                    parentStrength: 0
                });

                parentStrength = pConf.confidence;

                results.push({
                    category: pm.category,
                    confidence: pConf.confidence,
                    signal: 'parent',
                    reason: `Parent category influence from ${parentPath}`,
                    confidenceBreakdown: pConf.breakdown
                });
            }
        }

        // 3. Keyword matching
        const km = this.matchKeywordsToCategory(keywords);

        if (km.category !== 'Other') {
            const cobj = this.calculateConfidence({
                keywordScore: km.weightedScore,
                matchCount: km.matchCount,
                structuralSignal,
                domainAlignment: this.calculateDomainAlignment(km.category, domainType),
                parentStrength
            });

            results.push({
                category: km.category,
                confidence: cobj.confidence,
                signal: 'keyword',
                reason: `Keyword matches: ${km.matches.join(', ')}`,
                confidenceBreakdown: cobj.breakdown
            });
        }

        // 4. No match fallback
        if (!results.length) {
            return {
                category: 'Other',
                confidence: 0.1,
                reason: 'No strong match found',
                signal: 'none',
                alternatives: []
            };
        }

        // Sort best first
        results.sort((a,b) => b.confidence - a.confidence);

        return {
            ...results[0],
            alternatives: results.slice(1, 4)
        };
    },

    /* ---------------- Utility helpers ---------------- */

    getParentPath(path) {
        const parts = path.split('/').filter(Boolean);
        if (parts.length <= 1) return '';
        return '/' + parts.slice(0, -1).join('/');
    },

    generateUrlPatterns(urls) {
        const patterns = new Set();

        for (const url of urls) {
            let p = url;

            if (url.includes('://')) {
                try { p = new URL(url).pathname; } catch {}
            }

            p = this.normalizePath(p);
            patterns.add(p);

            const seg = p.split('/').filter(Boolean)[0];
            if (seg) patterns.add('/' + seg + '/*');
        }

        return Array.from(patterns).sort();
    },

    extractAllUrls(prioritizedUrls) {
        const out = new Set();

        if (!Array.isArray(prioritizedUrls)) return [];

        for (const row of prioritizedUrls) {
            const arr = row.topChildren || row.children || row.items;

            if (!Array.isArray(arr)) continue;

            for (const c of arr) {
                if (typeof c === 'string') out.add(c);
                if (c?.url) out.add(c.url);

                if (Array.isArray(c?.children)) {
                    c.children.forEach(d => {
                        if (typeof d === 'string') out.add(d);
                        if (d?.url) out.add(d.url);
                    });
                }
            }
        }

        return Array.from(out);
    },

});
/* ---------------- Part 3 (Batch C) ----------------
 * - Full category map (if not already present)
 * - Expanded synonyms override
 * - getBusinessPriority()
 * - rankAndLimitTopUrls()
 * - finalizeCategorizationResponse()
 * - export
 */

/* ---------------- Category keyword map (if not already present) ---------------- */
Object.assign(URLDynamicCategorizationService.prototype, {

    getCategoryKeywordMap() {
        if (!this.categoryKeywordMapCache) {
            this.categoryKeywordMapCache = {
                /* ---- ECOMMERCE ---- */
                'Product Categories': {
                    keywords: [
                        'product','products','shop','shopping','store','category','catalog','collection','browse','p',
                        'clothes','clothing','apparel','fashion','shoes','footwear','accessories','beauty','skincare','hair',
                        'lingerie','swimwear','sportswear','tops','bottoms','dresses','shirts','pants','jeans','leggings',
                        'jackets','coats','sweaters','hoodies','tshirts','t-shirt','outerwear',
                        'new-in','new','collections','bestsellers','best-sellers','sale','clearance'
                    ],
                    score: 9
                },

                'Offers & Sales': {
                    keywords: [
                        'offer','offers','sale','discount','discounts','promo','promotion','promotions',
                        'deal','deals','clearance','coupon','coupons','voucher','vouchers','flash-sale',
                        'limited-offer','limited-time'
                    ],
                    score: 9
                },

                'Payment & Financial': {
                    keywords: [
                        'payment','payments','billing','bill','invoice','invoices','checkout','cart','transaction',
                        'financial','card','cards','credit','debit','pay','pay-now','paylater','emi',
                        'payment-options','payment-methods','payment-success','refund','refunds','refund-policy',
                        'pricing','price','prices','cost','charges','fees'
                    ],
                    score: 10
                },

                /* ---- ACCOUNT & USER ---- */
                'Account & User Functions': {
                    keywords: [
                        'account','accounts','login','log-in','signin','sign-in','register','signup','sign-up',
                        'profile','user','users','password','reset-password','my-account','dashboard','settings',
                        'preferences','profile-settings','my-profile'
                    ],
                    score: 9
                },

                'Account Management': {
                    keywords: [
                        'my-bookings','my-orders','myaccount','my-account','manage','manage-account','check-in',
                        'cancel','modify','update-details','track','bookings','order-history','order-status'
                    ],
                    score: 9
                },

                'Loyalty & Rewards': {
                    keywords: [
                        'loyalty','rewards','points','membership','members','reward-program','club','vip',
                        'reward','earn-points','redeem','redeem-points'
                    ],
                    score: 7
                },

                /* ---- TRAVEL / BOOKING ---- */
                'Booking & Reservations': {
                    keywords: [
                        'booking','book','reservation','reserve','search','schedule','appointment','appointments',
                        'flight','flights','hotel','hotels','room','rooms','stay','trips','trip','itinerary',
                        'check-availability'
                    ],
                    score: 9
                },

                'Booking – Travel Specific': {
                    keywords: [
                        'check-in','checkin','boarding-pass','boarding','manage-booking','manage-reservation',
                        'itinerary','pnr','ticket','tickets','booking-confirmation','seat-selection'
                    ],
                    score: 8
                },

                'Shipping & Delivery': {
                    keywords: [
                        'shipping','delivery','deliveries','returns','return','refund','refunds',
                        'return-policy','exchange','exchanges','tracking','track-order','track','dispatch','carrier'
                    ],
                    score: 8
                },

                /* ---- SUPPORT / HELP ---- */
                'FAQ / Knowledgebase': {
                    keywords: [
                        'faq','faqs','knowledgebase','knowledge-base','kb','support-articles','guides',
                        'manual','manuals','documentation','docs','help-article','help-articles'
                    ],
                    score: 8
                },

                'Contact & Support': {
                    keywords: [
                        'contact','contact-us','support','customer-service','customer-support','chat','livechat',
                        'live-chat','email-us','call-us','ticket','submit-request','support-request','get-in-touch',
                        'help-center','helpdesk','help-desk'
                    ],
                    score: 8
                },

                'Guides & Educational Content': {
                    keywords: [
                        'guide','guides','education','tutorial','tutorials','how-to','howto','advice',
                        'tips','learn','learning','knowledge','documentation','walkthrough','getting-started'
                    ],
                    score: 7
                },

                /* ---- COMPANY & LEGAL ---- */
                'About / Company': {
                    keywords: [
                        'about','about-us','who-we-are','company','our-story','mission','vision','values',
                        'leadership','team','teams','press','press-release','press-centre','press-center'
                    ],
                    score: 6
                },

                'Legal & Compliance': {
                    keywords: [
                        'terms','terms-and-conditions','privacy','privacy-policy','policy','policies','legal',
                        'disclaimer','cookie','cookies','cookie-policy','gdpr','compliance','security',
                        'data-protection'
                    ],
                    score: 7
                },

                'Careers & Jobs': {
                    keywords: [
                        'careers','career','jobs','job','join-us','opportunities','vacancies','work-with-us',
                        'apply','applications','internship','internships'
                    ],
                    score: 7
                },

                /* ---- MEDIA & CONTENT ---- */
                'News & Information': {
                    keywords: [
                        'news','blog','blogs','articles','article','update','updates','press','announcement',
                        'announcements','media','stories','story'
                    ],
                    score: 7
                },

                'Media / Gallery': {
                    keywords: [
                        'gallery','galleries','media','photos','images','pictures','videos','video',
                        'photo','podcast','podcasts','media-center','media-centre'
                    ],
                    score: 6
                },

                'Testimonials & Reviews': {
                    keywords: [
                        'reviews','review','testimonials','testimonial','ratings','rating','trustpilot',
                        'customer-feedback','feedback'
                    ],
                    score: 6
                },

                /* ---- EDUCATION ---- */
                'Guides & Tutorials': {
                    keywords: [
                        'tutorial','tutorials','howto','how-to','walkthrough','guide','guides','lesson',
                        'lessons','course','courses','training','trainings','academy','class','classes'
                    ],
                    score: 7
                },

                /* ---- CORPORATE / INVESTOR ---- */
                'Investors & Corporate Governance': {
                    keywords: [
                        'investor','investors','ir','shareholders','financials','reports','governance',
                        'board','annual-report','annual-reports'
                    ],
                    score: 7
                },

                'Sustainability & Corporate': {
                    keywords: [
                        'sustainability','environment','green','carbon','corporate','company','esg',
                        'business','sustainability-report'
                    ],
                    score: 6
                },

                /* ---- TECH / API ---- */
                'Developer / API': {
                    keywords: [
                        'api','apis','developer','developers','sdk','sdks','endpoints','endpoint',
                        'rest','graphql','integration','integrations','webhooks','docs','documentation',
                        'developer-portal','dev-portal'
                    ],
                    score: 7
                },

                /* ---- MARKETING / CAMPAIGNS ---- */
                'Campaigns & Landing Pages': {
                    keywords: [
                        'landing','landing-page','campaign','campaigns','lp','promo','microsite',
                        'campaign-landing','hero','marketing','utm'
                    ],
                    score: 6
                },

                /* ---- STORE / LOCATOR ---- */
                'Store Locator / Branch Locator': {
                    keywords: [
                        'store-locator','find-store','locator','locations','branches','branch','near-me',
                        'nearby','find-us'
                    ],
                    score: 6
                },

                /* ---- SUBSCRIPTIONS ---- */
                'Subscription & Pricing': {
                    keywords: [
                        'plans','plan','subscriptions','subscription','subscribe','pricing','pricing-plan',
                        'packages','package','membership','memberships','billing-plans'
                    ],
                    score: 7
                },

                /* ---- SERVICES ---- */
                'Product Services': {
                    keywords: [
                        'baggage','seat','addon','add-on','extra','extras','service','services','upgrade',
                        'insurance','protection','warranty','coverage'
                    ],
                    score: 6
                },

                'Product Comparison': {
                    keywords: [
                        'compare','comparison','vs','versus','compare-products','compare-models','compare-plans'
                    ],
                    score: 5
                },

                'Quote & Conversion': {
                    keywords: [
                        'quote','quotes','estimate','estimates','pricing','price','cost','request-quote',
                        'get-quote','cost-estimate'
                    ],
                    score: 6
                },

                'Events & Promotions': {
                    keywords: [
                        'events','event','webinar','webinars','conference','conferences','seminar','seminars',
                        'expo','meetup','festival','schedule'
                    ],
                    score: 5
                },

                'Accessibility & Special Services': {
                    keywords: [
                        'accessibility','special','assistance','disabled','accessible','wcag','accessibility-statement'
                    ],
                    score: 6
                },

                'Sitemap': {
                    keywords: ['sitemap','site-map','site_map','siteindex'],
                    score: 4
                },

                'Other': {
                    keywords: [],
                    score: 1
                }
            };
        }
        return this.categoryKeywordMapCache;
    },

    // Expanded synonyms override
    getKeywordSynonyms() {
        if (!this.keywordSynonymCache) {
            const map = {
                products: ['product','prod','items','goods','merchandise','sku','item'],
                shop: ['store','shopping','purchase','buy','shop'],
                profile: ['account','user','my-account','my-profile','profile','profile-settings'],
                help: ['support','assistance','aid','help','help-center','helpdesk','support-center','customer-support'],
                payment: ['billing','checkout','transaction','invoice','pay','payments','card','payment','bill','charges','fees'],
                booking: ['book','reservation','reserve','booking','bookings','reservations'],
                order: ['orders','order-history','order','purchase','buy'],
                guide: ['tutorial','how-to','howto','guides','guide','walkthrough','getting-started'],
                sale: ['discount','offer','promo','promotion','sale','clearance','deal','coupon','voucher'],
                contact: ['support','help','email','messaging','contact','contact-us','get-in-touch','call-us'],
                auth: ['login','signin','signup','register','logout','authenticate','auth','log-in','sign-in','sign-up'],
                cart: ['cart','basket','checkout','bag','shopping-cart'],
                api: ['api','developer','developers','sdk','endpoint','endpoints','developer-portal','dev-portal'],
                legal: ['terms','privacy','policy','policies','legal','disclaimer','cookie','cookie-policy','gdpr']
            };
            Object.keys(map).forEach(k => {
                map[k] = Array.from(new Set(map[k].map(s => s.toLowerCase())));
            });
            this.keywordSynonymCache = map;
        }
        this.synonymLookupCache = null;
        return this.keywordSynonymCache;
    }

}); // end Object.assign for Part 3 additions

/* ---------------- Business priority mapping + ranking ---------------- */

URLDynamicCategorizationService.prototype.getBusinessPriority = function(categoryName = '', url = '/') {
    const path = (typeof url === 'string' ? url : '/') || '/';
    const p = this.normalizePath(path).toLowerCase();
    const cat = (categoryName || '').toString();

    // Base mapping from category -> bucket
    const mapping = {
        // PLP (90)
        'Product Categories': 90,
        'Offers & Sales': 90,
        'Product Comparison': 90,
        'Product Services': 90,

        // PDP (80)
        'Booking & Reservations': 80,
        'Booking – Travel Specific': 80,
        'Shipping & Delivery': 80,

        // Checkout / Payment (60)
        'Payment & Financial': 60,
        'Subscription & Pricing': 60,
        'Quote & Conversion': 60,

        // Account / Login / Profile (50)
        'Account & User Functions': 50,
        'Account Management': 50,
        'Loyalty & Rewards': 50,

        // Other bucket (10)
        'FAQ / Knowledgebase': 10,
        'Contact & Support': 10,
        'Guides & Educational Content': 10,
        'About / Company': 10,
        'Legal & Compliance': 10,
        'Careers & Jobs': 10,
        'News & Information': 10,
        'Media / Gallery': 10,
        'Testimonials & Reviews': 10,
        'Guides & Tutorials': 10,
        'Investors & Corporate Governance': 10,
        'Sustainability & Corporate': 10,
        'Developer / API': 10,
        'Campaigns & Landing Pages': 10,
        'Store Locator / Branch Locator': 10,
        'Events & Promotions': 10,
        'Accessibility & Special Services': 10,
        'Sitemap': 10,
        'Other': 10
    };

    // default priority from category mapping
    let base = mapping.hasOwnProperty(cat) ? mapping[cat] : 10;

    // URL-based adjustments (strong signals)
    // Homepage
    if (p === '/' || p === '') return 100;

    // PLP heuristics - if path matches listing/catalog keywords
    if (/\/(category|categories|catalog|collection|shop|products|browse|collections)(\b|\/|$)/i.test(p)) {
        base = Math.max(base, 90);
    }

    // PDP heuristics - product detail style paths
    if (/\/(product|products|p|item|sku)\/(?!$)/i.test(p) || /-[0-9]{3,}|\/.+\.[a-z0-9]{2,4}$/i.test(p)) {
        base = Math.max(base, 80);
    }

    // Cart
    if (/\/(cart|basket|shopping-cart|bag)(\b|\/|$)/i.test(p)) base = Math.max(base, 70);

    // Checkout
    if (/\/(checkout|payment|billing|order\/checkout)(\b|\/|$)/i.test(p)) base = Math.max(base, 60);

    // Account / Login paths
    if (/\/(login|signin|register|account|my-account|profile|dashboard)(\b|\/|$)/i.test(p)) base = Math.max(base, 50);

    // Ensure returned numeric priority is one of the allowed set
    const allowed = [100,90,80,70,60,50,10];
    if (!allowed.includes(base)) {
        // snap to nearest bucket
        if (base >= 95) base = 100;
        else if (base >= 85) base = 90;
        else if (base >= 75) base = 80;
        else if (base >= 65) base = 70;
        else if (base >= 55) base = 60;
        else if (base >= 45) base = 50;
        else base = 10;
    }

    return base;
};

/* ---------------- Rank + per-category cap enforcement ---------------- */

URLDynamicCategorizationService.prototype.rankAndLimitTopUrls = function(urlDetails = [], limit = 25, perCategoryLimit = 2) {
    if (!Array.isArray(urlDetails)) return [];

    const bucketed = {}; // category -> count
    const ranked = [];

    for (const item of urlDetails) {
        if (!item || !item.url) continue;

        const category = item.category || 'Other';
        const confidence = item.confidence || 0;
        const path = item.url;

        const priority = this.getBusinessPriority(category, path);
        const finalScore = (priority * 2) + confidence;

        ranked.push({
            url: item.url,
            category,
            confidence,
            priority,
            finalScore,
            reason: item.reason || '',
            signal: item.signal || ''
        });
    }

    // Sort by finalScore descending
    ranked.sort((a, b) => b.finalScore - a.finalScore);

    const output = [];

    for (const r of ranked) {
        const cat = r.category;

        // Enforce max per-category
        bucketed[cat] = bucketed[cat] || 0;
        if (bucketed[cat] >= perCategoryLimit) continue;

        bucketed[cat]++;
        output.push(r);

        if (output.length >= limit) break;
    }

    return output;
};

/* ---------------- Finalize response helper ---------------- */

/*
 * finalizeCategorizationResponse(inputs)
 * - inputs: { allUrls, cleaned, urlDetails, categories, domainType, patterns }
 * - Produces the final return object (same shape as original categorizeDynamically),
 *   with prioritizedTop25 inserted and per-category cap applied.
 */
URLDynamicCategorizationService.prototype.finalizeCategorizationResponse = function({ allUrls = [], cleaned = [], urlDetails = [], categories = [], domainType = {type: 'unknown', confidence: 0}, patterns = {} } = {}) {

    const allConf = urlDetails.map(r => r.confidence || 0);
    const avgConfidence = allConf.length ? (allConf.reduce((a, b) => a + b, 0) / allConf.length) : 0;
    const highConfidenceCount = urlDetails.filter(r => (r.confidence || 0) >= 0.75).length;
    const signalDistribution = {};
    urlDetails.forEach(r => {
        signalDistribution[r.signal] = (signalDistribution[r.signal] || 0) + 1;
    });

    const categoriesSummary = categories.map(cat => {
        const avgConfidenceCat = cat.confidences && cat.confidences.length
            ? cat.confidences.reduce((a,b) => a + b, 0) / cat.confidences.length
            : cat.confidence || 0;
        return {
            category: cat.category,
            urls: cat.urls || [],
            count: cat.count || (cat.urls ? cat.urls.length : 0),
            keywords: cat.keywords || [],
            urlPatterns: cat.urlPatterns || [],
            confidence: parseFloat((avgConfidenceCat).toFixed(2)),
            confidenceRange: cat.confidenceRange || { min: 0, max: 0 },
            signals: cat.signals || {}
        };
    });

    // prioritizedTop25 (business-priority + confidence + per-category cap)
    const prioritizedTop25 = this.rankAndLimitTopUrls(urlDetails, 25, 5);

    return {
        success: true,
        totalUrlsCollected: allUrls.length,
        totalUrlsFiltered: allUrls.length - cleaned.length,
        totalUrlsCategorized: cleaned.length,
        categories: categoriesSummary,
        prioritizedTop25,
        quality: {
            averageConfidence: parseFloat(avgConfidence.toFixed(2)),
            highConfidenceUrls: {
                count: highConfidenceCount,
                percentage: cleaned.length
                    ? parseFloat(((highConfidenceCount / cleaned.length) * 100).toFixed(1))
                    : 0
            },
            signalDistribution,
            algorithmVersion: 'v3-optimized-safe'
        },
        summary: {
            topCategories: categoriesSummary.slice(0, 5).map(c => ({ category: c.category, count: c.count })),
            totalCategories: categoriesSummary.length,
            averageUrlsPerCategory: categoriesSummary.length
                ? Math.round(cleaned.length / categoriesSummary.length)
                : 0,
            detectedDomainType: domainType.type,
            domainConfidence: Math.round((domainType.confidence || 0) * 100)
        },
        details: {
            domainType,
            patternsSummary: patterns
        }
    };
};
URLDynamicCategorizationService.prototype.categorizeDynamically = function (prioritizedUrls) {

    // Extract complete list of URLs from various shapes of prioritizedUrls
    const allUrls = this.extractAllUrls(prioritizedUrls || []);

    // Filter out technical / irrelevant paths (API, static, assets, etc.)
    const cleaned = allUrls.filter(u => {
        try {
            const path = this.normalizePath(u);
            return !this.getTechnicalPatterns().some(pattern => pattern.test(path));
        } catch {
            return false;
        }
    });

    // Build tree + structural patterns
    const tree = this.buildURLTree(cleaned);
    const patterns = this.analyzeTreePatterns(tree);
    const structuralSignals = this.computeStructuralSignals(tree);
    const domainType = this.detectDomainType(patterns, tree);

    // Prepare caches
    this.prepareCategoryKeywordSets();
    this.getSynonymLookup();

    const keywordCache = this.runtime.keywordCache;

    // Pre-extract keywords for urls
    for (const u of cleaned) {
        keywordCache.set(u, this.extractKeywords(u));
    }

    // Pre-extract keywords for tree paths
    for (const path of Object.keys(tree)) {
        const fakeUrl = path === '' ? '/' : path;
        keywordCache.set(path, this.extractKeywords(fakeUrl));
    }

    // Context for smart categorizer
    const context = {
        tree,
        patterns,
        domainType,
        signals: structuralSignals,
        keywordCache
    };

    const categorizedMap = new Map();
    const urlDetails = [];

    // Classify each URL
    for (const url of cleaned) {
        const result = this.findBestCategorySmartly(url, context);
        const cat = result.category || 'Other';

        // Build URL-level detail object
        urlDetails.push({
            url,
            category: cat,
            confidence: result.confidence,
            signal: result.signal,
            reason: result.reason,
            alternatives: result.alternatives || []
        });

        // Insert into category bucket
        if (!categorizedMap.has(cat)) {
            categorizedMap.set(cat, {
                category: cat,
                urls: [],
                keywords: new Set(),
                confidences: [],
                reasons: [],
                signals: {}
            });
        }

        const entry = categorizedMap.get(cat);
        entry.urls.push(url);
        entry.confidences.push(result.confidence);
        entry.reasons.push(result.reason);
        entry.signals[result.signal] = (entry.signals[result.signal] || 0) + 1;

        const kws = this.extractKeywords(url);
        kws.forEach(k => entry.keywords.add(k));
    }

    // Convert map → array
    const categories = Array.from(categorizedMap.values()).map(cat => ({
        category: cat.category,
        urls: cat.urls,
        count: cat.urls.length,
        keywords: Array.from(cat.keywords).sort(),
        urlPatterns: this.generateUrlPatterns(cat.urls),
        confidences: cat.confidences,
        confidenceRange: {
            min: parseFloat(Math.min(...cat.confidences).toFixed(2)),
            max: parseFloat(Math.max(...cat.confidences).toFixed(2))
        },
        signals: cat.signals
    })).sort((a, b) => b.count - a.count);

    // Return final output with prioritizedTop25
    return this.finalizeCategorizationResponse({
        allUrls,
        cleaned,
        urlDetails,
        categories,
        domainType,
        patterns
    });
};

/* ---------------- Export ---------------- */

try {
    // Node environment
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = new URLDynamicCategorizationService();
    }
} catch (e) {
    // ignore
}

