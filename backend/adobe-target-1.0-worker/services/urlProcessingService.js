const normalizeUrl = (url) => {
    try {
        if (!url || typeof url !== 'string') return null;
        let normalized = url.trim();
        if (!normalized.match(/^https?:\/\//i)) normalized = 'https://' + normalized;
        const urlObj = new URL(normalized);
        return urlObj.href;
    } catch (error) { return null; }
};


class UrlPrioritizationService {
  normalizeProtocol(url) {
    if (url.startsWith('http://')) {
      return url.replace('http://', 'https://');
    }
    return url;
  }

  detectLocale(pathname) {
    const match1 = pathname.match(/^\/([a-z]{2})\/([a-z]{2})\//);
    if (match1) {
      return {
        locale: `${match1[1]}/${match1[2]}`,
        localePrefix: `/${match1[1]}/${match1[2]}/`,
        remainingPath: pathname.slice(`/${match1[1]}/${match1[2]}/`.length)
      };
    }
    const match2 = pathname.match(/^\/([a-z]{2})-([a-z]{2})\//);
    if (match2) {
      return {
        locale: `${match2[1]}-${match2[2]}`,
        localePrefix: `/${match2[1]}-${match2[2]}/`,
        remainingPath: pathname.slice(`/${match2[1]}-${match2[2]}/`.length)
      };
    }
    const match3 = pathname.match(/^\/([a-z]{2})\//);
    if (match3) {
      return {
        locale: match3[1],
        localePrefix: `/${match3[1]}/`,
        remainingPath: pathname.slice(`/${match3[1]}/`.length)
      };
    }
    return null;
  }

  removeQueryString(url) {
    const urlObj = new URL(url);
    return urlObj.origin + urlObj.pathname;
  }

  groupUrlsByBaseUrl(urls) {
    const urlMap = new Map();
    for (const url of urls) {
      const baseUrl = this.removeQueryString(url);
      const urlObj = new URL(url);
      const queryString = urlObj.search;
      if (!urlMap.has(baseUrl)) {
        urlMap.set(baseUrl, {
          baseUrl: baseUrl,
          variants: new Set(),
          queryParams: new Set()
        });
      }
      const entry = urlMap.get(baseUrl);
      entry.variants.add(url);
      if (queryString) {
        entry.queryParams.add(queryString);
      }
    }
    return urlMap;
  }

  groupUrlsByLocale(urls, baseDomain) {
    const localeMap = new Map();
    for (const url of urls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;
      const localeInfo = this.detectLocale(parsed.pathname);
      const locale = localeInfo ? localeInfo.locale : 'default';
      const localePrefix = localeInfo ? localeInfo.localePrefix : '/';
      if (!localeMap.has(locale)) {
        const localeUrl = localeInfo
          ? `${baseDomain}${localeInfo.localePrefix.slice(0, -1)}`
          : baseDomain;
        localeMap.set(locale, {
          locale: locale,
          localeUrl: localeUrl,
          localePrefix: localePrefix,
          urls: []
        });
      }
      localeMap.get(locale).urls.push(url);
    }
    return localeMap;
  }

  extractSectionName(remainingPath) {
    const segments = remainingPath.split('/').filter(s => s.length > 0);
    return segments[0] || '';
  }

  groupBySectionWithVariants(localeUrls, baseDomain) {
    const sectionMap = new Map();
    for (const url of localeUrls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;
      const localeInfo = this.detectLocale(parsed.pathname);
      const remainingPath = localeInfo ? localeInfo.remainingPath : parsed.pathname.slice(1);
      const sectionName = this.extractSectionName(remainingPath);
      const baseUrl = this.removeQueryString(url);
      if (!sectionMap.has(sectionName)) {
        sectionMap.set(sectionName, {
          baseUrl: baseUrl,
          sectionName: sectionName,
          variants: new Set(),
          variantCount: 0
        });
      }
      const entry = sectionMap.get(sectionName);
      entry.variants.add(url);
      entry.variantCount = entry.variants.size - 1;
    }
    return sectionMap;
  }

  parseUrl(url, baseDomain = 'https://www.example.com') {
    try {
      let fullUrl;
      if (url.startsWith('/')) {
        fullUrl = baseDomain + url;
      } else if (!url.startsWith('http')) {
        fullUrl = 'https://' + url;
      } else {
        fullUrl = url;
      }
      fullUrl = this.normalizeProtocol(fullUrl);
      const urlObj = new URL(fullUrl);
      const domain = urlObj.origin;
      const pathSegments = urlObj.pathname
        .split('/')
        .filter(segment => segment.length > 0);
      return {
        fullUrl,
        pathSegments,
        domain,
        pathname: urlObj.pathname
      };
    } catch (error) {
      console.error(`Error parsing URL: ${url}`, error.message);
      return null;
    }
  }

  getParentPath(pathSegments, depth) {
    if (depth <= 0 || depth > pathSegments.length) {
      return null;
    }
    return '/' + pathSegments.slice(0, depth).join('/');
  }

  buildHierarchyMap(urls, baseDomain) {
    const hierarchyMap = new Map();
    const urlMetadata = new Map();
    for (const url of urls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;
      urlMetadata.set(url, parsed);
      for (let depth = 1; depth <= parsed.pathSegments.length; depth++) {
        const parentPath = this.getParentPath(parsed.pathSegments, depth);
        if (!parentPath) continue;
        if (!hierarchyMap.has(parentPath)) {
          hierarchyMap.set(parentPath, {
            count: 0,
            children: new Set(),
            domain: parsed.domain
          });
        }
        const parent = hierarchyMap.get(parentPath);
        parent.count += 1;
        parent.children.add(url);
      }
    }
    return { hierarchyMap, urlMetadata };
  }

  countDescendants(url, allUrls, baseDomain) {
    const parsed = this.parseUrl(url, baseDomain);
    if (!parsed) return 0;
    const parentSegments = parsed.pathSegments;
    let descendantCount = 0;
    for (const otherUrl of allUrls) {
      if (otherUrl === url) continue;
      const otherParsed = this.parseUrl(otherUrl, baseDomain);
      if (!otherParsed || otherParsed.domain !== parsed.domain) continue;
      if (otherParsed.pathSegments.length > parentSegments.length) {
        const isDescendant = parentSegments.every(
          (segment, idx) => segment === otherParsed.pathSegments[idx]
        );
        if (isDescendant) {
          descendantCount += 1;
        }
      }
    }
    return descendantCount;
  }

  getTopChildrenByFrequency(children, allUrls, baseDomain, topN = 3) {
    if (!children || children.length === 0) return [];
    const childrenWithCounts = children.map(child => ({
      url: child,
      descendantCount: this.countDescendants(child, allUrls, baseDomain)
    }));
    childrenWithCounts.sort((a, b) => b.descendantCount - a.descendantCount);
    return childrenWithCounts.slice(0, Math.min(topN, children.length)).map(item => item.url);
  }

  normalizeUrls(urls) {
    let baseDomain = 'https://www.example.com';
    for (const url of urls) {
      if (url.startsWith('http')) {
        try {
          const urlObj = new URL(url);
          baseDomain = urlObj.origin;
          break;
        } catch (e) {}
      }
    }
    return urls.map(url => {
      if (url.startsWith('/')) {
        return baseDomain + url;
      } else if (!url.startsWith('http')) {
        return baseDomain + '/' + url;
      }
      return url;
    });
  }

  findCommonRoot(urls, baseDomain) {
    if (!urls || urls.length === 0) return null;
    const allSegments = urls.map(url => {
      const parsed = this.parseUrl(url, baseDomain);
      return parsed ? parsed.pathSegments : [];
    });
    const minLength = Math.min(...allSegments.map(s => s.length));
    if (minLength === 0) return '/';
    let commonLength = 0;
    for (let i = 0; i < minLength; i++) {
      const segment = allSegments[0][i];
      if (allSegments.every(segs => segs[i] === segment)) {
        commonLength = i + 1;
      } else {
        break;
      }
    }
    return commonLength > 0 ? '/' + allSegments[0].slice(0, commonLength).join('/') : '/';
  }

  getDirectChildren(urls, rootPath, baseDomain) {
    const childrenMap = new Map();
    for (const url of urls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;
      if (parsed.domain !== baseDomain) {
        console.log(`⏭️  Skipping external domain: ${parsed.domain} (root domain: ${baseDomain})`);
        continue;
      }
      if (parsed.pathname === rootPath || parsed.pathname === rootPath + '/') continue;
      let isUnderRoot = false;
      if (rootPath === '/') {
        isUnderRoot = parsed.pathname.startsWith('/') && parsed.pathname !== '/';
      } else {
        isUnderRoot = parsed.pathname.startsWith(rootPath + '/');
      }
      if (!isUnderRoot) continue;
      let remainingPath;
      if (rootPath === '/') {
        remainingPath = parsed.pathname;
      } else {
        remainingPath = parsed.pathname.slice(rootPath.length);
      }
      const remainingSegments = remainingPath.split('/').filter(s => s.length > 0);
      if (remainingSegments.length > 0) {
        let cleanPath;
        if (rootPath === '/') {
          cleanPath = '/' + remainingSegments[0];
        } else {
          cleanPath = rootPath + '/' + remainingSegments[0];
        }
        const cleanUrl = parsed.domain + cleanPath;
        if (!childrenMap.has(cleanUrl)) {
          const descendantCount = this.countDescendants(cleanUrl, urls, baseDomain);
          childrenMap.set(cleanUrl, {
            url: cleanUrl,
            descendantCount: descendantCount
          });
        }
      }
    }
    const sortedChildren = Array.from(childrenMap.values())
      .sort((a, b) => b.descendantCount - a.descendantCount)
      .map(item => item.url);
    return sortedChildren;
  }

  getSectionLevelParents(hierarchyMap, baseDomain) {
    const sectionParents = [];
    for (const [parentPath, info] of hierarchyMap.entries()) {
      if (info.domain !== baseDomain) continue;
      const depth = parentPath.split('/').filter(s => s.length > 0).length;
      if (depth === 1) {
        sectionParents.push({
          path: parentPath,
          url: baseDomain + parentPath,
          count: info.count,
          domain: info.domain
        });
      }
    }
    return sectionParents;
  }

  getAllDescendants(sectionPath, normalizedUrls, baseDomain) {
    const descendants = [];
    for (const url of normalizedUrls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;
      if (parsed.domain !== baseDomain) continue;
      const isUnderSection = parsed.pathname.startsWith(sectionPath + '/') ||
                            parsed.pathname === sectionPath;
      if (isUnderSection) {
        descendants.push(url);
      }
    }
    const uniqueDescendants = Array.from(new Set(descendants));
    return uniqueDescendants.sort((urlA, urlB) => {
      const parsedA = this.parseUrl(urlA, baseDomain);
      const parsedB = this.parseUrl(urlB, baseDomain);
      if (!parsedA || !parsedB) return 0;
      const depthDiff = parsedA.pathSegments.length - parsedB.pathSegments.length;
      if (depthDiff !== 0) return depthDiff;
      return parsedA.fullUrl.localeCompare(parsedB.fullUrl);
    });
  }

  calculateVariantCountByDepth(topChildren, baseDomain) {
    const variantCount = {
      total: topChildren.length,
      byDepth: {}
    };
    for (const url of topChildren) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;
      const depth = parsed.pathSegments.length;
      const depthKey = `depth${depth}`;
      if (!variantCount.byDepth[depthKey]) {
        variantCount.byDepth[depthKey] = 0;
      }
      variantCount.byDepth[depthKey]++;
    }
    return variantCount;
  }

  deduplicateTrailingSlash(urls) {
    if (!urls || urls.length === 0) {
      return urls;
    }
    const seen = new Set();
    const result = [];
    const sortedUrls = [...urls].sort();
    for (const url of sortedUrls) {
      const normalized = url.endsWith('/') ? url.slice(0, -1) : url;
      if (!seen.has(normalized)) {
        result.push(url);
        seen.add(normalized);
      }
    }
    return result;
  }

  getTopChildren(children, allUrlsSet, limit = 2) {
    if (!children || children.length === 0) {
      return children;
    }
    if (children.length <= limit) {
      return children.sort();
    }
    const childrenWithCounts = children.map(childUrl => {
      let descendantCount = 0;
      for (const url of allUrlsSet) {
        if (url.startsWith(childUrl + '/') || url === childUrl) {
          descendantCount++;
        }
      }
      return {
        url: childUrl,
        descendantCount: descendantCount
      };
    });
    const sorted = childrenWithCounts.sort((a, b) => {
      if (b.descendantCount !== a.descendantCount) {
        return b.descendantCount - a.descendantCount;
      }
      return a.url.localeCompare(b.url);
    });
    return sorted.slice(0, limit).map(item => item.url);
  }

  buildHierarchicalStructure(flatUrls, baseDomain) {
    if (!flatUrls || flatUrls.length === 0) {
      return [];
    }
    const verifiedUrls = new Set();
    for (const url of flatUrls) {
      const baseUrl = this.removeQueryString(url);
      verifiedUrls.add(baseUrl);
    }
    const parentMap = new Map();
    for (const url of flatUrls) {
      const parsed = this.parseUrl(url, baseDomain);
      if (!parsed) continue;
      const pathSegments = parsed.pathSegments;
      const baseUrl = this.removeQueryString(url);
      if (!parentMap.has(baseUrl)) {
        parentMap.set(baseUrl, new Set());
      }
      if (pathSegments.length > 0) {
        const parentSegments = pathSegments.slice(0, -1);
        const parentPath = parentSegments.length > 0 ? '/' + parentSegments.join('/') : '';
        const directParentUrl = baseDomain + parentPath;
        if (!parentMap.has(directParentUrl)) {
          parentMap.set(directParentUrl, new Set());
        }
        parentMap.get(directParentUrl).add(baseUrl);
      }
    }
    const hierarchicalUrls = [];
    const sortedParents = Array.from(parentMap.keys()).sort();
    const allUrlsSet = new Set(flatUrls.map(url => this.removeQueryString(url)));
    for (const parentUrl of sortedParents) {
      let children = Array.from(parentMap.get(parentUrl) || new Set());
      if (children.length === 0 && !verifiedUrls.has(parentUrl)) {
        continue;
      }
      children = this.deduplicateTrailingSlash(children);
      if (children.length > 0) {
        const isVerified = verifiedUrls.has(parentUrl);
        const limitedChildren = this.getTopChildren(children, allUrlsSet, 2);
        hierarchicalUrls.push({
          url: parentUrl,
          children: limitedChildren,
          wasCollected: isVerified
        });
        const childCountLabel = children.length > 2 ? `${limitedChildren.length}/2 top` : `${limitedChildren.length}`;
        console.log(`✓ Parent: ${parentUrl} → ${childCountLabel} children (from ${children.length} total)`);
      }
    }
    console.log(`\n📊 Built hierarchy: ${hierarchicalUrls.length} parents with top 2 direct children`);
    return hierarchicalUrls;
  }

  shouldSkipHierarchical(url) {
    try {
      let pathname = url;
      if (url.startsWith('http')) {
        const urlObj = new URL(url);
        pathname = urlObj.pathname;
      }
      return pathname.includes('/browse/') || pathname.includes('/browse');
    } catch (e) {
      return false;
    }
  }

  prioritizeUrls(urls, options = {}) {
    if (!urls || urls.length === 0) {
      return { prioritizedUrls: [], localesDetected: false };
    }
    try {
      const normalizedUrls = this.normalizeUrls(urls);
      const protocolNormalizedUrls = normalizedUrls.map(url => this.normalizeProtocol(url));
      console.log(`✅ Normalized ${protocolNormalizedUrls.length} URLs (protocol + domain)`);
      let baseDomain = 'https://www.example.com';
      for (const url of protocolNormalizedUrls) {
        if (url.startsWith('http')) {
          try {
            const urlObj = new URL(url);
            baseDomain = urlObj.origin;
            break;
          } catch (e) {}
        }
      }
      console.log(`📍 Base domain: ${baseDomain}`);
      const samedomainUrls = protocolNormalizedUrls.filter(url => {
        try {
          const urlObj = new URL(url);
          return urlObj.origin === baseDomain;
        } catch (e) {
          return false;
        }
      });
      console.log(`🔗 Filtered URLs: ${protocolNormalizedUrls.length} total → ${samedomainUrls.length} same domain`);
      if (protocolNormalizedUrls.length - samedomainUrls.length > 0) {
        console.log(`⏭️  Removed ${protocolNormalizedUrls.length - samedomainUrls.length} external domain URLs`);
      }
      const localeMap = this.groupUrlsByLocale(samedomainUrls, baseDomain);
      const hasLocalePattern = Array.from(localeMap.keys()).some(locale => locale !== 'default');
      const localesDetected = hasLocalePattern;
      if (localesDetected) {
        console.log(`🌍 Locale-aware grouping detected: ${localeMap.size} locale(s)`);
        for (const [locale, info] of localeMap.entries()) {
          console.log(`   ├─ ${locale}: ${info.urls.length} URLs`);
        }
      }
      const prioritizedUrls = [];
      const sortedLocales = Array.from(localeMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      for (const [localeName, localeInfo] of sortedLocales) {
        console.log(`\n🔍 Processing locale: ${localeName}`);
        if (localesDetected) {
          const sectionMap = this.groupBySectionWithVariants(localeInfo.urls, baseDomain);
          const sortedSections = Array.from(sectionMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]));
          const topChildren = [];
          const variantsBySection = {};
          for (const [sectionName, sectionInfo] of sortedSections) {
            topChildren.push(sectionInfo.baseUrl);
            if (sectionInfo.variantCount > 0) {
              variantsBySection[sectionName] = sectionInfo.variantCount;
            }
          }
          const shouldSkipHierarchy = topChildren.some(url => this.shouldSkipHierarchical(url));
          let finalTopChildren;
          if (shouldSkipHierarchy) {
            console.log(`⏭️  Skipping hierarchical categorization for /browse/ paths`);
            finalTopChildren = topChildren.sort();
          } else {
            finalTopChildren = this.buildHierarchicalStructure(topChildren.sort(), baseDomain);
          }
          prioritizedUrls.push({
            url: localeInfo.localeUrl,
            locale: localeName,
            topChildren: finalTopChildren
          });
          console.log(`✅ Added locale ${localeName} with ${topChildren.length} sections`);
        } else {
          const { hierarchyMap } = this.buildHierarchyMap(localeInfo.urls, baseDomain);
          const sectionParents = this.getSectionLevelParents(hierarchyMap, baseDomain);
          sectionParents.sort((a, b) => a.path.localeCompare(b.path));
          for (const sectionParent of sectionParents) {
            const allDescendants = this.getAllDescendants(sectionParent.path, localeInfo.urls, baseDomain);
            if (allDescendants.length === 0) continue;
            const shouldSkipHierarchy = this.shouldSkipHierarchical(sectionParent.url);
            let finalTopChildren;
            if (shouldSkipHierarchy) {
              console.log(`⏭️  Skipping hierarchical categorization for ${sectionParent.url}`);
              finalTopChildren = allDescendants.sort();
            } else {
              finalTopChildren = this.buildHierarchicalStructure(allDescendants, baseDomain);
            }
            prioritizedUrls.push({
              url: sectionParent.url,
              topChildren: finalTopChildren
            });
          }
        }
      }
      console.log(`\n✅ Generated ${prioritizedUrls.length} prioritized entries`);
      console.log(`🌍 Locales detected: ${localesDetected}`);
      if (prioritizedUrls.length === 0) {
        console.warn('⚠️  No hierarchical parents discovered; using fallback prioritization');
        const fallbackEntries = this.buildFallbackPrioritizedEntries(samedomainUrls, baseDomain, options.fallbackLimit || 10);
        prioritizedUrls.push(...fallbackEntries);
      }
      return { prioritizedUrls, localesDetected };
    } catch (error) {
      console.error('Error in prioritizeUrls:', error);
      throw error;
    }
  }

  buildFallbackPrioritizedEntries(urls = [], baseDomain, limit = 10) {
    if (!Array.isArray(urls) || urls.length === 0) {
      return [];
    }
    const rootChildren = this.getDirectChildren(urls, '/', baseDomain);
    const normalizedSet = new Set(urls.map(url => this.removeQueryString(url)));
    const fallback = [];
    for (const childUrl of rootChildren) {
      if (fallback.length >= limit) break;
      let childPath = '/';
      try {
        const parsed = new URL(childUrl);
        childPath = parsed.pathname || '/';
      } catch (e) {
        continue;
      }
      const grandChildren = this.getDirectChildren(urls, childPath, baseDomain);
      const rankedChildren = this.getTopChildren(grandChildren, normalizedSet, 2);
      fallback.push({
        url: childUrl,
        topChildren: rankedChildren.length ? rankedChildren : []
      });
    }
    if (fallback.length === 0) {
      const limited = Array.from(normalizedSet).slice(0, limit);
      limited.forEach(url => fallback.push({ url, topChildren: [] }));
    }
    return fallback;
  }
}


class URLDynamicCategorizationService {
    constructor(options = {}) {
        this.fuzzyThreshold = options.fuzzyThreshold ?? 88;
        this.fuzzyLengthDelta = options.fuzzyLengthDelta ?? 3;
        this.maxKeywordsForScoring = options.maxKeywordsForScoring ?? 12;
        this.keywordSynonymCache = null;
        this.synonymLookupCache = null;
        this.categoryKeywordMapCache = null;
        this.categoryKeywordSets = null;
        this.technicalPatternCache = null;
        this.stopWordsCache = null;
        this.runtime = {
            keywordCache: new Map(),
            fuzzyCache: new Map(),
            structuralSignals: null,
            treeCache: null
        };
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
                /^\/api\//i, /^\/v\d+\//i, /^\/assets\//i, /^\/static\//i, /^\/public\//i,
                /^\/images\//i, /^\/fonts\//i, /^\/css\//i, /^\/js\//i, /^\/dist\//i,
                /^\/__next\//i, /^\/.well-known\//i, /\.min\.(js|css)$/i, /^\/.env/i,
                /^\.git/i, /^\/node_modules\//i, /^\/bundle\//i, /^\/app\.(js|css)$/i,
                /^\/favicon/i, /^\/robots\.txt/i, /^\/sitemap/i
            ];
        }
        return this.technicalPatternCache;
    }

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

    normalizePath(url) {
        let path = url;
        if (!path || typeof path !== 'string') return '/';
        if (url.includes('://')) {
            try {
                const u = new URL(url);
                path = u.pathname || '/';
            } catch {}
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
            seg = seg.replace(/([a-z])([A-Z])/g, '$1 $2');
            const parts = seg.split(/[ -_.+]+/i).filter(Boolean);
            for (let p of parts) {
                const cleaned = p.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!cleaned) continue;
                if (/^\d+$/.test(cleaned)) continue;
                if (cleaned.length <= 2 && stop.has(cleaned)) continue;
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
    }

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
    }
    
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
    }
    
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
    }
    
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
    }
    
    calculateDomainAlignment(categoryName, domainType) {
        const hint = this.getCategoryDomainHint(categoryName);
        if (!hint) return 0;

        if (domainType.type === hint && domainType.confidence > 0)
            return Math.min(1, 0.5 + domainType.confidence / 2);

        const hintScore = domainType.scores?.[hint] || 0;
        const totalScore = Object.values(domainType.scores).reduce((a,b) => a+b, 0);

        return totalScore ? Number((hintScore / totalScore).toFixed(2)) : 0;
    }
    
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
    }

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
    }
    
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
    }
    
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
    }
    
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

        if (!results.length) {
            return {
                category: 'Other',
                confidence: 0.1,
                reason: 'No strong match found',
                signal: 'none',
                alternatives: []
            };
        }

        results.sort((a,b) => b.confidence - a.confidence);

        return {
            ...results[0],
            alternatives: results.slice(1, 4)
        };
    }
    
    getParentPath(path) {
        const parts = path.split('/').filter(Boolean);
        if (parts.length <= 1) return '';
        return '/' + parts.slice(0, -1).join('/');
    }

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
    }

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
    }
    
    getCategoryKeywordMap() {
        if (!this.categoryKeywordMapCache) {
            this.categoryKeywordMapCache = {
                'Product Categories': {
                    keywords: ['product','products','shop','shopping','store','category','catalog','collection','browse','p','clothes','clothing','apparel','fashion','shoes','footwear','accessories','beauty','skincare','hair','lingerie','swimwear','sportswear','tops','bottoms','dresses','shirts','pants','jeans','leggings','jackets','coats','sweaters','hoodies','tshirts','t-shirt','outerwear','new-in','new','collections','bestsellers','best-sellers','sale','clearance'],
                    score: 9
                },
                'Offers & Sales': {
                    keywords: ['offer','offers','sale','discount','discounts','promo','promotion','promotions','deal','deals','clearance','coupon','coupons','voucher','vouchers','flash-sale','limited-offer','limited-time'],
                    score: 9
                },
                'Payment & Financial': {
                    keywords: ['payment','payments','billing','bill','invoice','invoices','checkout','cart','transaction','financial','card','cards','credit','debit','pay','pay-now','paylater','emi','payment-options','payment-methods','payment-success','refund','refunds','refund-policy','pricing','price','prices','cost','charges','fees'],
                    score: 10
                },
                'Account & User Functions': {
                    keywords: ['account','accounts','login','log-in','signin','sign-in','register','signup','sign-up','profile','user','users','password','reset-password','my-account','dashboard','settings','preferences','profile-settings','my-profile'],
                    score: 9
                },
                'Account Management': {
                    keywords: ['my-bookings','my-orders','myaccount','my-account','manage','manage-account','check-in','cancel','modify','update-details','track','bookings','order-history','order-status'],
                    score: 9
                },
                'Loyalty & Rewards': {
                    keywords: ['loyalty','rewards','points','membership','members','reward-program','club','vip','reward','earn-points','redeem','redeem-points'],
                    score: 7
                },
                'Booking & Reservations': {
                    keywords: ['booking','book','reservation','reserve','search','schedule','appointment','appointments','flight','flights','hotel','hotels','room','rooms','stay','trips','trip','itinerary','check-availability'],
                    score: 9
                },
                'Booking – Travel Specific': {
                    keywords: ['check-in','checkin','boarding-pass','boarding','manage-booking','manage-reservation','itinerary','pnr','ticket','tickets','booking-confirmation','seat-selection'],
                    score: 8
                },
                'Shipping & Delivery': {
                    keywords: ['shipping','delivery','deliveries','returns','return','refund','refunds','return-policy','exchange','exchanges','tracking','track-order','track','dispatch','carrier'],
                    score: 8
                },
                'FAQ / Knowledgebase': {
                    keywords: ['faq','faqs','knowledgebase','knowledge-base','kb','support-articles','guides','manual','manuals','documentation','docs','help-article','help-articles'],
                    score: 8
                },
                'Contact & Support': {
                    keywords: ['contact','contact-us','support','customer-service','customer-support','chat','livechat','live-chat','email-us','call-us','ticket','submit-request','support-request','get-in-touch','help-center','helpdesk','help-desk'],
                    score: 8
                },
                'Guides & Educational Content': {
                    keywords: ['guide','guides','education','tutorial','tutorials','how-to','howto','advice','tips','learn','learning','knowledge','documentation','walkthrough','getting-started'],
                    score: 7
                },
                'About / Company': {
                    keywords: ['about','about-us','who-we-are','company','our-story','mission','vision','values','leadership','team','teams','press','press-release','press-centre','press-center'],
                    score: 6
                },
                'Legal & Compliance': {
                    keywords: ['terms','terms-and-conditions','privacy','privacy-policy','policy','policies','legal','disclaimer','cookie','cookies','cookie-policy','gdpr','compliance','security','data-protection'],
                    score: 7
                },
                'Careers & Jobs': {
                    keywords: ['careers','career','jobs','job','join-us','opportunities','vacancies','work-with-us','apply','applications','internship','internships'],
                    score: 7
                },
                'News & Information': {
                    keywords: ['news','blog','blogs','articles','article','update','updates','press','announcement','announcements','media','stories','story'],
                    score: 7
                },
                'Media / Gallery': {
                    keywords: ['gallery','galleries','media','photos','images','pictures','videos','video','photo','podcast','podcasts','media-center','media-centre'],
                    score: 6
                },
                'Testimonials & Reviews': {
                    keywords: ['reviews','review','testimonials','testimonial','ratings','rating','trustpilot','customer-feedback','feedback'],
                    score: 6
                },
                'Guides & Tutorials': {
                    keywords: ['tutorial','tutorials','howto','how-to','walkthrough','guide','guides','lesson','lessons','course','courses','training','trainings','academy','class','classes'],
                    score: 7
                },
                'Investors & Corporate Governance': {
                    keywords: ['investor','investors','ir','shareholders','financials','reports','governance','board','annual-report','annual-reports'],
                    score: 7
                },
                'Sustainability & Corporate': {
                    keywords: ['sustainability','environment','green','carbon','corporate','company','esg','business','sustainability-report'],
                    score: 6
                },
                'Developer / API': {
                    keywords: ['api','apis','developer','developers','sdk','sdks','endpoints','endpoint','rest','graphql','integration','integrations','webhooks','docs','documentation','developer-portal','dev-portal'],
                    score: 7
                },
                'Campaigns & Landing Pages': {
                    keywords: ['landing','landing-page','campaign','campaigns','lp','promo','microsite','campaign-landing','hero','marketing','utm'],
                    score: 6
                },
                'Store Locator / Branch Locator': {
                    keywords: ['store-locator','find-store','locator','locations','branches','branch','near-me','nearby','find-us'],
                    score: 6
                },
                'Subscription & Pricing': {
                    keywords: ['plans','plan','subscriptions','subscription','subscribe','pricing','pricing-plan','packages','package','membership','memberships','billing-plans'],
                    score: 7
                },
                'Product Services': {
                    keywords: ['baggage','seat','addon','add-on','extra','extras','service','services','upgrade','insurance','protection','warranty','coverage'],
                    score: 6
                },
                'Product Comparison': {
                    keywords: ['compare','comparison','vs','versus','compare-products','compare-models','compare-plans'],
                    score: 5
                },
                'Quote & Conversion': {
                    keywords: ['quote','quotes','estimate','estimates','pricing','price','cost','request-quote','get-quote','cost-estimate'],
                    score: 6
                },
                'Events & Promotions': {
                    keywords: ['events','event','webinar','webinars','conference','conferences','seminar','seminars','expo','meetup','festival','schedule'],
                    score: 5
                },
                'Accessibility & Special Services': {
                    keywords: ['accessibility','special','assistance','disabled','accessible','wcag','accessibility-statement'],
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
    }
    
    getBusinessPriority(categoryName = '', url = '/') {
    const path = (typeof url === 'string' ? url : '/') || '/';
    const p = this.normalizePath(path).toLowerCase();
    const cat = (categoryName || '').toString();

    const mapping = {
        'Product Categories': 90, 'Offers & Sales': 90, 'Product Comparison': 90, 'Product Services': 90,
        'Booking & Reservations': 80, 'Booking – Travel Specific': 80, 'Shipping & Delivery': 80,
        'Payment & Financial': 60, 'Subscription & Pricing': 60, 'Quote & Conversion': 60,
        'Account & User Functions': 50, 'Account Management': 50, 'Loyalty & Rewards': 50,
        'FAQ / Knowledgebase': 10, 'Contact & Support': 10, 'Guides & Educational Content': 10,
        'About / Company': 10, 'Legal & Compliance': 10, 'Careers & Jobs': 10,
        'News & Information': 10, 'Media / Gallery': 10, 'Testimonials & Reviews': 10,
        'Guides & Tutorials': 10, 'Investors & Corporate Governance': 10,
        'Sustainability & Corporate': 10, 'Developer / API': 10, 'Campaigns & Landing Pages': 10,
        'Store Locator / Branch Locator': 10, 'Events & Promotions': 10,
        'Accessibility & Special Services': 10, 'Sitemap': 10, 'Other': 10
    };

    let base = mapping.hasOwnProperty(cat) ? mapping[cat] : 10;

    if (p === '/' || p === '') return 100;

    if (/(^|\/)(category|categories|catalog|collection|shop|products|browse|collections)(\b|\/|$)/i.test(p)) {
        base = Math.max(base, 90);
    }

    if (/(^|\/)(product|products|p|item|sku)(\/|$)/i.test(p) || /-[0-9]{3,}|\[a-z0-9]{2,4}$/i.test(p)) {
        base = Math.max(base, 80);
    }

    if (/(^|\/)(cart|basket|shopping-cart|bag)(\b|\/|$)/i.test(p)) base = Math.max(base, 70);
    if (/(^|\/)(checkout|payment|billing|order\/checkout)(\b|\/|$)/i.test(p)) base = Math.max(base, 60);
    if (/(^|\/)(login|signin|register|account|my-account|profile|dashboard)(\b|\/|$)/i.test(p)) base = Math.max(base, 50);

    const allowed = [100,90,80,70,60,50,10];
    if (!allowed.includes(base)) {
        if (base >= 95) base = 100;
        else if (base >= 85) base = 90;
        else if (base >= 75) base = 80;
        else if (base >= 65) base = 70;
        else if (base >= 55) base = 60;
        else if (base >= 45) base = 50;
        else base = 10;
    }

    return base;
    }
    
    rankAndLimitTopUrls(urlDetails = [], limit = 25, perCategoryLimit = 2) {
    if (!Array.isArray(urlDetails)) return [];

    const excludedCategories = new Set([
        'FAQ / Knowledgebase','Contact & Support','Guides & Educational Content','Accessibility & Special Services',
        'Legal & Compliance','Careers & Jobs','About / Company','News & Information','Loyalty & Rewards'
    ]);

    const bucketed = {};
    const categoryTotals = {};
    const ranked = [];

    for (const item of urlDetails) {
        if (!item || !item.url) continue;
        const category = item.category || 'Other';
        const confidence = item.confidence || 0;
        const path = item.url;
        const priority = this.getBusinessPriority(category, path);
        const finalScore = (priority * 2) + confidence;
        if (excludedCategories.has(category)) continue;
        ranked.push({ url: item.url, category, confidence, priority, finalScore, reason: item.reason || '', signal: item.signal || '' });
        categoryTotals[category] = (categoryTotals[category] || 0) + 1;
    }

    const eligibleCount = ranked.length || 1;
    ranked.sort((a, b) => b.finalScore - a.finalScore);
    const categorySlotCaps = {};
    for (const cat of Object.keys(categoryTotals)) {
        const share = categoryTotals[cat] / eligibleCount;
        const baseSlots = Math.max(1, Math.ceil(share * limit * 0.8));
        const priorityBoost = ranked.find(r => r.category === cat)?.priority || 0;
        const maxAllowed = priorityBoost >= 80 ? 6 : priorityBoost >= 60 ? 5 : 4;
        categorySlotCaps[cat] = Math.min(maxAllowed, Math.max(perCategoryLimit, baseSlots));
    }

    const addCandidate = (candidate, output, enforceCap = true) => {
        const cat = candidate.category;
        bucketed[cat] = bucketed[cat] || 0;
        if (enforceCap) {
            const cap = categorySlotCaps[cat] || perCategoryLimit;
            if (bucketed[cat] >= cap) {
                return false;
            }
        }
        bucketed[cat]++;
        output.push(candidate);
        return true;
    };

    const output = [];
    const coveredCategories = new Set();
    for (const candidate of ranked) {
        if (output.length >= limit) break;
        const { category, priority } = candidate;
        if (coveredCategories.has(category)) continue;
        if (priority < 50) continue;
        if (addCandidate(candidate, output, true)) {
            coveredCategories.add(category);
        }
    }

    for (const candidate of ranked) {
        if (output.length >= limit) break;
        if (output.some(entry => entry.url === candidate.url)) continue;
        addCandidate(candidate, output, true);
    }

    if (output.length < limit && ranked.length > output.length) {
        const remaining = ranked.filter(c => !output.some(entry => entry.url === c.url));
        for (const candidate of remaining) {
            if (output.length >= limit) break;
            addCandidate(candidate, output, false);
        }
    }
    return output;
    }
    
    finalizeCategorizationResponse({ allUrls = [], cleaned = [], urlDetails = [], categories = [], domainType = {type: 'unknown', confidence: 0}, patterns = {} } = {}) {

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
    }
    
    categorizeDynamically(prioritizedUrls) {
    const allUrls = this.extractAllUrls(prioritizedUrls || []);
    const documentExtensions = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|7z|tar|gz|xml|json)$/i;
    const cleaned = allUrls.filter(u => {
        try {
            const path = this.normalizePath(u);
            if (this.getTechnicalPatterns().some(pattern => pattern.test(path))) {
                return false;
            }
            if (documentExtensions.test(u)) {
                console.log(`🗑️  Filtered out document file (dynamic): ${u}`);
                return false;
            }
            return true;
        } catch {
            return false;
        }
    });

    const tree = this.buildURLTree(cleaned);
    const patterns = this.analyzeTreePatterns(tree);
    const structuralSignals = this.computeStructuralSignals(tree);
    const domainType = this.detectDomainType(patterns, tree);

    this.prepareCategoryKeywordSets();
    this.getSynonymLookup();

    const keywordCache = this.runtime.keywordCache;

    for (const u of cleaned) {
        keywordCache.set(u, this.extractKeywords(u));
    }
    for (const path of Object.keys(tree)) {
        const fakeUrl = path === '' ? '/' : path;
        keywordCache.set(path, this.extractKeywords(fakeUrl));
    }

    const context = {
        tree,
        patterns,
        domainType,
        signals: structuralSignals,
        keywordCache
    };

    const categorizedMap = new Map();
    const urlDetails = [];

    for (const url of cleaned) {
        const result = this.findBestCategorySmartly(url, context);
        const cat = result.category || 'Other';
        urlDetails.push({
            url,
            category: cat,
            confidence: result.confidence,
            signal: result.signal,
            reason: result.reason,
            alternatives: result.alternatives || []
        });
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

    return this.finalizeCategorizationResponse({
        allUrls,
        cleaned,
        urlDetails,
        categories,
        domainType,
        patterns
    });
    }
}

const urlPrioritizationService = new UrlPrioritizationService();
const urlDynamicCategorizationService = new URLDynamicCategorizationService();

module.exports = {
    urlPrioritizationService,
    urlDynamicCategorizationService,
    normalizeUrl
};
