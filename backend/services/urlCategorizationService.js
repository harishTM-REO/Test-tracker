const axios = require("axios");
const cheerio = require("cheerio");
const {
  launchBrowser,
  createPage,
  navigateToPage,
  handleCookieConsent,
  detectCaptcha,
  closeBrowser
} = require('../utils/helper');

class UrlCategorizationService {

  /**
   * Main categories for URL classification
   */
  categories = {
    // E-commerce categories
    HOME: 'home',
    PRODUCT_LISTING: 'product_listing',
    PRODUCT_DETAIL: 'product_detail',
    CART: 'cart',
    CHECKOUT: 'checkout',
    SEARCH_RESULTS: 'search_results',
    CATEGORY_PAGE: 'category_page',

    // Account & User pages
    ACCOUNT: 'account',
    LOGIN: 'login',
    REGISTER: 'register',
    PROFILE: 'profile',
    ORDERS: 'orders',
    WISHLIST: 'wishlist',

    // Content pages
    BLOG: 'blog',
    ARTICLE: 'article',
    ABOUT: 'about',
    CONTACT: 'contact',
    FAQ: 'faq',
    HELP: 'help',
    ACCESSIBILITY: 'accessibility',
    REVIEWS: 'reviews',

    // Legal & Policy
    TERMS: 'terms',
    PRIVACY: 'privacy',
    RETURNS: 'returns',
    SHIPPING: 'shipping',

    // Quote & Pricing
    QUOTE: 'quote',
    PRICING: 'pricing',

    // Financial & Investment
    INVESTMENT: 'investment',

    // Social Media & External
    SOCIAL_MEDIA: 'social_media',

    // Other
    OTHER: 'other',
    EXTERNAL: 'external'
  };

  /**
   * Categorize a single URL based on patterns and optional content analysis
   * @param {string} url - URL to categorize
   * @param {Object} options - Options for categorization
   * @returns {Promise<Object>} Categorization result
   */
  async categorizeUrl(url, options = {}) {
    const {
      analyzeContent = false,
      fetchTimeout = 5000
    } = options;

    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname.toLowerCase();
      const searchParams = urlObj.searchParams;

      // Initial categorization based on URL pattern
      const patternCategory = this.categorizeByPattern(pathname, searchParams, urlObj.hostname);

      let contentCategory = null;
      let contentAnalysis = null;
      let confidence = patternCategory.confidence;

      // If content analysis is enabled and confidence is low, fetch and analyze content
      if (analyzeContent && confidence < 0.8) {
        try {
          const contentResult = await this.analyzePageContent(url, fetchTimeout);
          contentCategory = contentResult.category;
          contentAnalysis = contentResult.analysis;

          // If content category is different and has high confidence, use it
          if (contentResult.confidence > confidence) {
            confidence = contentResult.confidence;
          }
        } catch (error) {
          console.error(`Error analyzing content for ${url}:`, error.message);
        }
      }

      // Final category determination
      const finalCategory = contentCategory && contentCategory !== this.categories.OTHER
        ? contentCategory
        : patternCategory.category;

      return {
        url: url,
        category: finalCategory,
        subCategory: patternCategory.subCategory,
        confidence: confidence,
        patternMatch: patternCategory.category,
        contentMatch: contentCategory,
        indicators: patternCategory.indicators,
        contentAnalysis: contentAnalysis,
        metadata: {
          domain: urlObj.hostname,
          path: pathname,
          hasQueryParams: searchParams.toString().length > 0,
          pathDepth: pathname.split('/').filter(p => p).length
        }
      };

    } catch (error) {
      console.error(`Error categorizing URL ${url}:`, error.message);
      return {
        url: url,
        category: this.categories.OTHER,
        confidence: 0,
        error: error.message
      };
    }
  }

  /**
   * Categorize URL based on pattern matching
   * @param {string} pathname - URL pathname
   * @param {URLSearchParams} searchParams - URL search parameters
   * @param {string} hostname - URL hostname
   * @returns {Object} Pattern-based categorization
   */
  categorizeByPattern(pathname, searchParams, hostname) {
    const indicators = [];
    let category = this.categories.OTHER;
    let subCategory = null;
    let confidence = 0.5;

    // Check subdomain and hostname for special pages BEFORE checking pathname
    const fullHostname = hostname.toLowerCase();
    const hasSubdomain = (hostname.match(/\./g) || []).length > 1;

    // Review Platform Detection - Check FIRST to avoid false positives
    const reviewPlatforms = {
      'trustpilot.com': { name: 'trustpilot', confidence: 0.95 },
      'uk.trustpilot.com': { name: 'trustpilot', confidence: 0.95 },
      'reviews.io': { name: 'reviews_io', confidence: 0.95 },
      'reviews.co.uk': { name: 'reviews_co_uk', confidence: 0.95 },
      'yotpo.com': { name: 'yotpo', confidence: 0.95 },
      'bazaarvoice.com': { name: 'bazaarvoice', confidence: 0.95 },
      'feefo.com': { name: 'feefo', confidence: 0.95 },
      'reevoo.com': { name: 'reevoo', confidence: 0.95 },
      'sitejabber.com': { name: 'sitejabber', confidence: 0.95 },
      'consumeraffairs.com': { name: 'consumeraffairs', confidence: 0.95 },
      'yelp.com': { name: 'yelp', confidence: 0.95 },
      'tripadvisor.com': { name: 'tripadvisor', confidence: 0.95 },
      'glassdoor.com': { name: 'glassdoor', confidence: 0.95 },
      'g2.com': { name: 'g2', confidence: 0.95 },
      'capterra.com': { name: 'capterra', confidence: 0.95 },
      'trustradius.com': { name: 'trustradius', confidence: 0.95 }
    };

    // Check if the domain is a review platform
    for (const [domain, platform] of Object.entries(reviewPlatforms)) {
      if (fullHostname === domain || fullHostname === `www.${domain}` || fullHostname.endsWith(`.${domain}`)) {
        // Check if URL contains review-related paths
        if (/\/(review|reviews|rating|ratings|company|business)/.test(pathname)) {
          category = this.categories.REVIEWS;
          confidence = platform.confidence;
          subCategory = platform.name;
          indicators.push('review_platform_domain');
          return { category, subCategory, confidence, indicators };
        }
      }
    }

    // Social Media Detection - Check FIRST to avoid false positives
    const socialMediaPlatforms = {
      'facebook.com': { name: 'facebook', confidence: 0.95 },
      'fb.com': { name: 'facebook', confidence: 0.95 },
      'instagram.com': { name: 'instagram', confidence: 0.95 },
      'twitter.com': { name: 'twitter', confidence: 0.95 },
      'x.com': { name: 'twitter_x', confidence: 0.95 },
      'linkedin.com': { name: 'linkedin', confidence: 0.95 },
      'youtube.com': { name: 'youtube', confidence: 0.95 },
      'youtu.be': { name: 'youtube', confidence: 0.95 },
      'tiktok.com': { name: 'tiktok', confidence: 0.95 },
      'pinterest.com': { name: 'pinterest', confidence: 0.95 },
      'snapchat.com': { name: 'snapchat', confidence: 0.95 },
      'reddit.com': { name: 'reddit', confidence: 0.95 },
      'tumblr.com': { name: 'tumblr', confidence: 0.95 },
      'whatsapp.com': { name: 'whatsapp', confidence: 0.95 },
      'wa.me': { name: 'whatsapp', confidence: 0.95 },
      'telegram.org': { name: 'telegram', confidence: 0.95 },
      't.me': { name: 'telegram', confidence: 0.95 },
      'discord.com': { name: 'discord', confidence: 0.95 },
      'twitch.tv': { name: 'twitch', confidence: 0.95 },
      'vimeo.com': { name: 'vimeo', confidence: 0.95 },
      'flickr.com': { name: 'flickr', confidence: 0.95 },
      'medium.com': { name: 'medium', confidence: 0.9 },
      'quora.com': { name: 'quora', confidence: 0.9 },
      'wechat.com': { name: 'wechat', confidence: 0.95 },
      'weibo.com': { name: 'weibo', confidence: 0.95 },
      'line.me': { name: 'line', confidence: 0.95 }
    };

    // Check if the domain is a social media platform
    for (const [domain, platform] of Object.entries(socialMediaPlatforms)) {
      if (fullHostname === domain || fullHostname === `www.${domain}` || fullHostname.endsWith(`.${domain}`)) {
        category = this.categories.SOCIAL_MEDIA;
        confidence = platform.confidence;
        subCategory = platform.name;
        indicators.push('social_media_domain');
        return { category, subCategory, confidence, indicators };
      }
    }

    // Check for help/support/customer service subdomains
    if (/^(help|support|customerservice|customer-service|service|helpdesk|care)\./.test(fullHostname)) {
      category = this.categories.HELP;
      confidence = 0.9;
      indicators.push('help_subdomain');

      // If it's root path of help subdomain, still mark as help, not home
      if (pathname === '/' || pathname === '') {
        return { category, subCategory, confidence, indicators };
      }
    }

    // Check for account/login subdomains
    if (/^(account|accounts|myaccount|my|login|signin|auth|sso)\./.test(fullHostname)) {
      category = this.categories.ACCOUNT;
      confidence = 0.9;
      indicators.push('account_subdomain');

      if (pathname === '/' || pathname === '') {
        return { category, subCategory, confidence, indicators };
      }
    }

    // Check for shop/store/delivery subdomains
    if (/^(shop|store|buy|sameday|same-day|delivery|groceries|grocery|market)\./.test(fullHostname)) {
      category = this.categories.PRODUCT_LISTING;
      confidence = 0.85;
      indicators.push('shop_subdomain');

      if (pathname === '/' || pathname === '') {
        subCategory = 'subdomain_shop';
        return { category, subCategory, confidence, indicators };
      }
    }

    // Check for blog/content subdomains
    if (/^(blog|news|stories|community|forum)\./.test(fullHostname)) {
      category = this.categories.BLOG;
      confidence = 0.85;
      indicators.push('blog_subdomain');

      if (pathname === '/' || pathname === '') {
        return { category, subCategory, confidence, indicators };
      }
    }

    // Check for quote/pricing subdomains
    if (/^(quote|quotes|get-quote|getquote|pricing|price|estimate)\./.test(fullHostname)) {
      category = this.categories.QUOTE;
      confidence = 0.9;
      indicators.push('quote_subdomain');

      if (pathname === '/' || pathname === '') {
        return { category, subCategory, confidence, indicators };
      }
    }

    // Check for privacy/legal subdomains
    if (/^(privacy|legal|terms|policies|policy)\./.test(fullHostname)) {
      category = this.categories.PRIVACY;
      confidence = 0.9;
      indicators.push('privacy_subdomain');
      return { category, subCategory, confidence, indicators };
    }

    // Check for investment/financial domains - categorize as INVESTMENT
    // These are typically investor relations, financial services, or investment-focused sites
    const investmentDomainKeywords = [
      'investor', 'investors', 'investment', 'investments', 'finance', 'financial',
      'wealth', 'portfolio', 'capital', 'fund', 'funds', 'equity', 'stock',
      'trading', 'securities', 'asset', 'assets', 'banking', 'bank'
    ];

    // Check if hostname contains any investment keywords
    const hostnameWithoutTLD = fullHostname.split('.').slice(0, -1).join('.');
    if (investmentDomainKeywords.some(keyword => hostnameWithoutTLD.includes(keyword))) {
      category = this.categories.INVESTMENT;
      confidence = 0.9;
      indicators.push('investment_domain');
      subCategory = 'financial_services';
      return { category, subCategory, confidence, indicators };
    }

    // Check for healthcare/medical domains
    const healthcareDomainKeywords = [
      'health', 'medical', 'hospital', 'clinic', 'doctor', 'pharmacy',
      'medicine', 'healthcare', 'wellness', 'dental', 'dentist', 'veterinary',
      'vet', 'care', 'patient', 'diagnostic', 'lab', 'laboratory'
    ];

    if (healthcareDomainKeywords.some(keyword => hostnameWithoutTLD.includes(keyword))) {
      // Healthcare domains - treat as service-based, not organizational
      // Don't return here, let URL patterns determine if it's listing/detail/other
      indicators.push('healthcare_domain');
    }

    // Check for real estate/property domains
    const realEstateDomainKeywords = [
      'realestate', 'property', 'properties', 'homes', 'housing', 'realtor',
      'realty', 'estate', 'apartments', 'rentals', 'lease', 'land'
    ];

    if (realEstateDomainKeywords.some(keyword => hostnameWithoutTLD.includes(keyword))) {
      indicators.push('realestate_domain');
    }

    // Check for travel/hospitality domains
    const travelDomainKeywords = [
      'travel', 'hotel', 'resort', 'booking', 'vacation', 'tourism',
      'flight', 'airline', 'cruise', 'trip', 'journey', 'tour'
    ];

    if (travelDomainKeywords.some(keyword => hostnameWithoutTLD.includes(keyword))) {
      indicators.push('travel_domain');
    }

    // Check for food/restaurant domains
    const foodDomainKeywords = [
      'restaurant', 'food', 'cafe', 'coffee', 'dining', 'eatery',
      'kitchen', 'delivery', 'menu', 'catering', 'pizza', 'burger'
    ];

    if (foodDomainKeywords.some(keyword => hostnameWithoutTLD.includes(keyword))) {
      indicators.push('food_domain');
    }

    // Check for government/public sector domains
    const govDomainKeywords = [
      'gov', 'government', 'municipal', 'city', 'county', 'state',
      'federal', 'public', 'agency', 'department'
    ];

    if (govDomainKeywords.some(keyword => hostnameWithoutTLD.includes(keyword)) ||
        fullHostname.endsWith('.gov') || fullHostname.endsWith('.gov.uk')) {
      category = this.categories.OTHER;
      confidence = 0.95;
      indicators.push('government_domain');
      subCategory = 'government';
      return { category, subCategory, confidence, indicators };
    }

    // Check for non-commerce/organizational domains - categorize as OTHER
    // These are typically foundations, institutes, educational, or corporate sites
    const nonCommerceDomainKeywords = [
      'foundation', 'institute', 'charity', 'nonprofit', 'npo', 'ngo',
      'education', 'academy', 'university', 'college', 'school',
      'research', 'corporate', 'careers', 'jobs'
    ];

    // Check if hostname contains any non-commerce keywords
    if (nonCommerceDomainKeywords.some(keyword => hostnameWithoutTLD.includes(keyword))) {
      category = this.categories.OTHER;
      confidence = 0.9;
      indicators.push('non_commerce_domain');
      subCategory = 'organizational';
      return { category, subCategory, confidence, indicators };
    }

    // Check for external app store domains - categorize as OTHER
    const externalAppStoreDomains = [
      'itunes.apple.com',
      'apps.apple.com',
      'play.google.com',
      'chrome.google.com',
      'addons.mozilla.org',
      'microsoftedge.microsoft.com'
    ];

    for (const domain of externalAppStoreDomains) {
      if (fullHostname === domain || fullHostname.startsWith(domain)) {
        category = this.categories.OTHER;
        confidence = 0.95;
        indicators.push('external_app_store');
        subCategory = 'app_store';
        return { category, subCategory, confidence, indicators };
      }
    }

    // Check if it's a home page - Enhanced
    // Only mark as HOME if it's the root path AND either:
    // 1. No subdomain (main domain like costco.com)
    // 2. Common www subdomain
    const homePathPatterns = [
      /^\/$/,              // Root path
      /^\/index\.html?$/i, // index.html or index.htm
      /^\/home$/i,         // /home
      /^\/default\.html?$/i, // default.html
      /^\/main$/i,         // /main
      /^\/homepage$/i,     // /homepage
      /^\/welcome$/i,      // /welcome
      /^\/landing$/i       // /landing
    ];

    const isHomePath = pathname === '' || homePathPatterns.some(pattern => pattern.test(pathname));

    if (isHomePath) {
      const isMainDomain = !hasSubdomain || /^(www|www\d)\./.test(fullHostname);

      if (isMainDomain) {
        category = this.categories.HOME;
        confidence = 0.95;
        indicators.push('root_path');

        // Sub-categorize home pages
        if (/index/i.test(pathname)) subCategory = 'index_page';
        else if (/home|welcome|landing/i.test(pathname)) subCategory = 'named_home_page';
        else subCategory = 'root_domain';

        return { category, subCategory, confidence, indicators };
      } else {
        // It's a subdomain root, but we don't know what kind
        // Mark as category_page with lower confidence
        category = this.categories.CATEGORY_PAGE;
        confidence = 0.6;
        indicators.push('subdomain_root');
        subCategory = 'unknown_subdomain';
        return { category, subCategory, confidence, indicators };
      }
    }

    // Check for home with query params (e.g., /?ref=home, /?page=home)
    if ((pathname === '/' || pathname === '') && searchParams.size > 0) {
      const homeQueryIndicators = ['home', 'homepage', 'landing', 'index'];
      const hasHomeQuery = Array.from(searchParams.values()).some(value =>
        homeQueryIndicators.some(indicator => value.toLowerCase().includes(indicator))
      );

      if (hasHomeQuery) {
        category = this.categories.HOME;
        confidence = 0.85;
        indicators.push('home_query_param');
        subCategory = 'home_with_params';
        return { category, subCategory, confidence, indicators };
      }
    }

    const pathSegments = pathname.split('/').filter(p => p);

    // Document file detection - CHECK FIRST to avoid false categorization
    // PDFs, Word docs, Excel sheets, etc. should be categorized as OTHER
    const documentExtensions = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|csv|zip|rar|7z|tar|gz|xml|json)$/i;
    if (documentExtensions.test(pathname)) {
      category = this.categories.OTHER;
      confidence = 0.95;
      indicators.push('document_file');
      subCategory = 'file_download';
      return { category, subCategory, confidence, indicators };
    }

    // Content pages - CHECK FIRST to avoid false PDP matches
    const contentPatterns = [
      { pattern: /\/blog/i, category: this.categories.BLOG },
      { pattern: /\/article/i, category: this.categories.ARTICLE },
      { pattern: /\/news/i, category: this.categories.ARTICLE },
      { pattern: /\/about/i, category: this.categories.ABOUT },
      { pattern: /\/contact/i, category: this.categories.CONTACT },
      { pattern: /faq/i, category: this.categories.FAQ },  // Match "faq" or "faqs" anywhere in path
      { pattern: /\/help/i, category: this.categories.HELP },
      { pattern: /\/support/i, category: this.categories.HELP },
      { pattern: /\/reviews?/i, category: this.categories.REVIEWS },  // Match "review" or "reviews"
      { pattern: /\/ratings?/i, category: this.categories.REVIEWS },   // Match "rating" or "ratings"
      { pattern: /\/testimonials?/i, category: this.categories.REVIEWS },  // Match "testimonial" or "testimonials"
      { pattern: /\/feedback/i, category: this.categories.REVIEWS },

      // Corporate/Informational pages
      { pattern: /\/sustainability/i, category: this.categories.ARTICLE },
      { pattern: /\/responsibility/i, category: this.categories.ARTICLE },
      { pattern: /\/careers/i, category: this.categories.ABOUT },
      { pattern: /\/jobs/i, category: this.categories.ABOUT },
      { pattern: /\/investors/i, category: this.categories.ABOUT },
      { pattern: /\/company/i, category: this.categories.ABOUT },
      { pattern: /\/about-us/i, category: this.categories.ABOUT },
      { pattern: /\/our-story/i, category: this.categories.ABOUT },
      { pattern: /\/mission/i, category: this.categories.ABOUT },
      { pattern: /\/values/i, category: this.categories.ABOUT },
      { pattern: /\/leadership/i, category: this.categories.ABOUT },
      { pattern: /\/team/i, category: this.categories.ABOUT },
      { pattern: /\/press/i, category: this.categories.ARTICLE },
      { pattern: /\/media/i, category: this.categories.ARTICLE },
      { pattern: /\/newsroom/i, category: this.categories.ARTICLE },

      // Education & Training pages - listing pages
      { pattern: /\/training-courses-results/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/course-results/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/training-results/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/courses$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/training$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/training-courses$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/qualifications$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/certifications$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/programs$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/learning$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/workshops$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/seminars$/i, category: this.categories.PRODUCT_LISTING },

      // Services pages - listing pages
      { pattern: /\/services$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/our-services$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/all-services$/i, category: this.categories.PRODUCT_LISTING },

      // Healthcare/Medical pages - listing pages
      { pattern: /\/doctors$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/physicians$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/treatments$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/specialties$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/clinics$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/hospitals$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/find-a-doctor$/i, category: this.categories.PRODUCT_LISTING },

      // Real Estate pages - listing pages
      { pattern: /\/properties$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/listings$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/homes-for-sale$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/apartments$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/rentals$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/real-estate$/i, category: this.categories.PRODUCT_LISTING },

      // Travel/Hospitality pages - listing pages
      { pattern: /\/hotels$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/destinations$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/packages$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/tours$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/flights$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/cruises$/i, category: this.categories.PRODUCT_LISTING },

      // Food/Restaurant pages - listing pages
      { pattern: /\/restaurants$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/menu$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/locations$/i, category: this.categories.PRODUCT_LISTING },
      { pattern: /\/catering$/i, category: this.categories.PRODUCT_LISTING }
    ];

    for (const { pattern, category: cat } of contentPatterns) {
      if (pattern.test(pathname)) {
        category = cat;
        confidence = 0.85;
        indicators.push('content_pattern_match');
        return { category, subCategory, confidence, indicators };
      }
    }

    // Legal & Policy pages - CHECK BEFORE commerce patterns
    const legalPatterns = [
      { pattern: /\/legal/i, category: this.categories.TERMS },  // General legal pages
      { pattern: /\/terms/i, category: this.categories.TERMS },
      { pattern: /\/privacy/i, category: this.categories.PRIVACY },
      { pattern: /\/returns/i, category: this.categories.RETURNS },
      { pattern: /\/shipping/i, category: this.categories.SHIPPING },
      { pattern: /\/refund/i, category: this.categories.RETURNS },
      { pattern: /\/delivery/i, category: this.categories.SHIPPING },
      { pattern: /accessibility/i, category: this.categories.ACCESSIBILITY },  // Match "accessibility" or "webaccessibility" anywhere
      { pattern: /webaccessibility/i, category: this.categories.ACCESSIBILITY }  // Explicit match for webaccessibility
    ];

    for (const { pattern, category: cat } of legalPatterns) {
      if (pattern.test(pathname)) {
        category = cat;
        confidence = 0.9;
        indicators.push('legal_pattern_match');
        return { category, subCategory, confidence, indicators };
      }
    }

    // Account related pages - CHECK BEFORE commerce patterns
    const accountPatterns = [
      { pattern: /\/login/i, category: this.categories.LOGIN },
      { pattern: /\/signin/i, category: this.categories.LOGIN },
      { pattern: /\/register/i, category: this.categories.REGISTER },
      { pattern: /\/signup/i, category: this.categories.REGISTER },
      { pattern: /\/newsletter/i, category: this.categories.REGISTER },
      { pattern: /\/subscribe/i, category: this.categories.REGISTER },
      { pattern: /\/special-members-store/i, category: this.categories.REGISTER },
      { pattern: /\/membership/i, category: this.categories.REGISTER },
      { pattern: /\/members/i, category: this.categories.REGISTER },
      { pattern: /\/join/i, category: this.categories.REGISTER },
      { pattern: /\/enroll/i, category: this.categories.REGISTER },
      { pattern: /\/account/i, category: this.categories.ACCOUNT },
      { pattern: /\/profile/i, category: this.categories.PROFILE },
      { pattern: /\/my-account/i, category: this.categories.ACCOUNT },
      { pattern: /\/orders/i, category: this.categories.ORDERS },
      { pattern: /\/order-history/i, category: this.categories.ORDERS },
      { pattern: /\/wishlist/i, category: this.categories.WISHLIST },
      { pattern: /\/favorites/i, category: this.categories.WISHLIST }
    ];

    for (const { pattern, category: cat } of accountPatterns) {
      if (pattern.test(pathname)) {
        category = cat;
        confidence = 0.9;
        indicators.push('account_pattern_match');
        return { category, subCategory, confidence, indicators };
      }
    }

    // Quote & Pricing pages - CHECK BEFORE commerce patterns
    const quotePricingPatterns = [
      { pattern: /\/quote/i, category: this.categories.QUOTE },
      { pattern: /\/get-quote/i, category: this.categories.QUOTE },
      { pattern: /\/request-quote/i, category: this.categories.QUOTE },
      { pattern: /\/pricing/i, category: this.categories.PRICING },
      { pattern: /\/price/i, category: this.categories.PRICING },
      { pattern: /\/plans/i, category: this.categories.PRICING },
      { pattern: /\/estimate/i, category: this.categories.QUOTE }
    ];

    for (const { pattern, category: cat } of quotePricingPatterns) {
      if (pattern.test(pathname)) {
        category = cat;
        confidence = 0.85;
        indicators.push('quote_pricing_pattern_match');
        return { category, subCategory, confidence, indicators };
      }
    }

    // Search Results - CHECK BEFORE commerce patterns
    if (searchParams.has('q') || searchParams.has('query') || searchParams.has('search') ||
        /\/search/i.test(pathname) || /\/results/i.test(pathname)) {
      category = this.categories.SEARCH_RESULTS;
      confidence = 0.9;
      indicators.push('search_params_or_path');
      return { category, subCategory, confidence, indicators };
    }

    // Cart patterns - CHECK BEFORE PDP patterns
    const cartPatterns = [
      /\/cart/i, /\/basket/i, /\/bag/i, /\/shopping-cart/i,
      /\/shoppingcart/i, /\/mycart/i, /\/shopping-bag/i,
      /\/shoppingbag/i, /\/view-cart/i, /\/viewcart/i,
      /\/trolley/i, /\/order-basket/i, /\/my-bag/i,
      /\/mybag/i, /\/shop-cart/i
    ];

    if (cartPatterns.some(pattern => pattern.test(pathname))) {
      category = this.categories.CART;
      confidence = 0.95;
      indicators.push('cart_pattern_match');

      // Identify cart sub-types
      if (/empty/i.test(pathname)) subCategory = 'empty_cart';
      else if (/review/i.test(pathname)) subCategory = 'cart_review';

      return { category, subCategory, confidence, indicators };
    }

    // Cart query parameters
    if (searchParams.has('cart') || searchParams.has('basket') ||
        searchParams.has('viewcart') || searchParams.has('showcart')) {
      category = this.categories.CART;
      confidence = 0.9;
      indicators.push('cart_query_param');
      return { category, subCategory, confidence, indicators };
    }

    // Checkout patterns - CHECK BEFORE PDP patterns
    // Also includes booking/appointment patterns for service-based sites
    const checkoutPatterns = [
      /\/checkout/i, /\/payment/i, /\/billing/i, /\/purchase/i,
      /\/order-confirm/i, /\/place-order/i, /\/pay/i,
      // Booking/Appointment patterns (service equivalents of checkout)
      /\/book-now/i, /\/booking/i, /\/reservation/i, /\/book-appointment/i,
      /\/schedule/i, /\/make-appointment/i, /\/reserve/i
    ];

    if (checkoutPatterns.some(pattern => pattern.test(pathname))) {
      category = this.categories.CHECKOUT;
      confidence = 0.95;
      indicators.push('checkout_pattern_match');

      // Add subcategory for booking vs checkout
      if (/book|appointment|reservation|schedule|reserve/i.test(pathname)) {
        subCategory = 'booking_appointment';
      }

      return { category, subCategory, confidence, indicators };
    }

    // Product Detail Page patterns - CHECK FIRST before PLP patterns
    // Specific PDP patterns like /p/, /product/, /item/, /products/{slug}
    const pdpPatterns = [
      // Generic E-commerce PDP patterns
      /\/p\//i, /\/product\//i, /\/item\//i, /\/pd\//i,
      /\/dp\//i, /\/goods\//i,
      /pimprod\d+/i, /\/buy\//i, /productid=/i, /pid=/i,
      /\/sku\//i, /\/product-details\//i, /\/productdetails\//i,
      /\/prod\//i, /\/items\/[\w-]+/i,

      // Bikes & Cycling - individual product pages
      /\/bike\//i, /\/bicycle\//i, /\/cycle\//i,
      /\/bike-details\//i, /\/model\//i,

      // Automotive & Vehicles - individual vehicle pages
      /\/car\//i, /\/vehicle\//i, /\/automobile\//i,
      /\/vin\//i, /\/stock\//i, /\/motorcycle\//i, /\/truck\//i,

      // Fashion & Apparel - individual item pages
      /\/clothing\//i, /\/dress\//i, /\/shoe\//i, /\/shirt\//i,
      /\/jacket\//i, /\/pants\//i, /\/style\//i,

      // Electronics & Tech - individual device pages
      /\/laptop\//i, /\/phone\//i, /\/tablet\//i, /\/computer\//i,
      /\/device\//i, /\/model\//i, /\/smartphone\//i,

      // Home & Living - individual product pages
      /\/furniture-item\//i, /\/appliance\//i,

      // Jewelry & Watches - individual piece pages
      /\/ring\//i, /\/necklace\//i, /\/bracelet\//i, /\/watch\//i,
      /\/earring\//i,

      // Beauty & Personal Care - individual product pages
      /\/beauty-product\//i, /\/perfume\//i, /\/cosmetic\//i,

      // Books & Media - individual title pages
      /\/book\//i, /\/title\//i, /\/isbn\//i, /\/movie\//i, /\/album\//i,

      // Toys & Games - individual toy pages
      /\/toy\//i, /\/game\//i, /\/action-figure\//i, /\/doll\//i,

      // Pet Supplies - individual product pages
      /\/pet-product\//i, /\/pet-item\//i,

      // Baby & Kids - individual product pages
      /\/baby-product\//i, /\/baby-item\//i, /\/stroller\//i,

      // Food & Beverage - individual product pages
      /\/wine-bottle\//i, /\/beer\//i, /\/snack\//i,

      // Musical Instruments - individual instrument pages
      /\/guitar\//i, /\/piano\//i, /\/drum\//i, /\/instrument\//i,

      // Art & Crafts - individual supply pages
      /\/art-supply\//i, /\/craft-item\//i,

      // Education & Training - individual course/program pages
      /\/course\//i, /\/training-course\//i, /\/program\//i,
      /\/certification\//i, /\/qualification\//i, /\/workshop\//i, /\/seminar\//i,
      /\/class\//i, /\/lesson\//i,

      // Services - individual service pages
      /\/service\//i, /\/services\/[\w-]+/i,

      // Healthcare - individual pages
      /\/doctor\//i, /\/physician\//i, /\/treatment\//i, /\/specialty\//i,
      /\/clinic\//i, /\/hospital\//i, /\/appointment\//i,
      /\/provider\//i, /\/practitioner\//i,

      // Real Estate - individual property pages
      /\/property\//i, /\/listing\//i, /\/home\//i, /\/apartment\//i, /\/rental\//i,
      /\/mls\//i, /\/unit\//i,

      // Travel - individual pages
      /\/hotel\//i, /\/destination\//i, /\/package\//i, /\/tour\//i, /\/flight\//i,
      /\/booking\//i, /\/reservation\//i, /\/resort\//i, /\/room\//i,

      // Food/Restaurant - individual pages
      /\/restaurant\//i, /\/location\//i, /\/store\//i, /\/venue\//i,

      // Office & Stationery - individual product pages
      /\/office-product\//i, /\/stationery-item\//i,

      // Industrial & Scientific - individual product pages
      /\/equipment\//i, /\/machine\//i, /\/tool\//i
    ];

    // Check for /products/{product-slug} pattern (PDP, not PLP)
    // This matches URLs like /products/specific-product-name
    if (/\/products\/[\w-]+/i.test(pathname) && pathSegments.length === 2 && pathSegments[0] === 'products') {
      category = this.categories.PRODUCT_DETAIL;
      confidence = 0.9;
      indicators.push('pdp_products_slug_pattern');
      subCategory = 'products_slug';
      return { category, subCategory, confidence, indicators };
    }

    if (pdpPatterns.some(pattern => pattern.test(pathname) || pattern.test(searchParams.toString()))) {
      category = this.categories.PRODUCT_DETAIL;
      confidence = 0.9;
      indicators.push('pdp_pattern_match');

      // Determine sub-category
      if (/\d{6,}/.test(pathname)) subCategory = 'numeric_id';
      else if (/[\w-]+-\d+/.test(pathname)) subCategory = 'slug_with_id';

      return { category, subCategory, confidence, indicators };
    }

    // Numeric Product ID detection (e.g., /shop/category/25972/product-name/)
    // Check for 4-8 digit numeric IDs in the middle of the path
    // This catches PDPs with numeric IDs that would otherwise match /shop/ PLP pattern
    const pathParts = pathname.split('/').filter(part => part.length > 0);
    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i];
      // Check if this segment is a 4-8 digit number
      if (/^\d{4,8}$/.test(part)) {
        // Make sure there are segments after the ID (product name/slug)
        if (i < pathParts.length - 1 || pathParts.length >= 4) {
          category = this.categories.PRODUCT_DETAIL;
          confidence = 0.92;
          indicators.push('numeric_product_id_in_path');
          subCategory = 'numeric_id';
          return { category, subCategory, confidence, indicators };
        }
      }
    }

    // Product Listing / Category Page patterns - Enhanced
    // NOW check PLP patterns AFTER PDP patterns
    const plpPatterns = [
      // Generic commerce patterns
      /\/c\//i, /\/category\//i, /\/shop\//i, /\/browse\//i,
      /\/collection/i, /\/products$/i, /\/catalog\//i,
      /\/categories\//i, /\/department\//i, /\/store\//i,
      /categoryid=/i, /cat=/i, /\/products-services\//i,
      /\/solutions\//i, /\/offerings\//i, /\/product-category\//i,
      /\/our-products\//i, /\/all-products\//i, /\/shop-all\//i,
      /\/shopall\//i, /\/listing\//i, /\/list\//i, /\/deals\//i,
      /\/sales\//i, /\/clearance\//i, /\/new-arrivals\//i, /\/bestsellers\//i,
      /\/trending\//i, /\/featured\//i,

      // Bikes & Cycling
      /\/bikes\//i, /\/bicycles\//i, /\/cycles\//i, /\/cycling\//i,
      /\/bikes$/i, /\/bicycles$/i, /\/cycles$/i,
      /\/express-bikes/i, /\/ebikes\//i, /\/e-bikes\//i,
      /\/mountain-bikes/i, /\/road-bikes/i, /\/gravel-bikes/i,

      // Automotive & Vehicles
      /\/cars\//i, /\/vehicles\//i, /\/automobiles\//i, /\/autos\//i,
      /\/cars$/i, /\/vehicles$/i, /\/motorcycles\//i, /\/trucks\//i,
      /\/inventory\//i, /\/new-cars/i, /\/used-cars/i,

      // Fashion & Apparel
      /\/clothing\//i, /\/apparel\//i, /\/fashion\//i, /\/wear\//i,
      /\/mens\//i, /\/womens\//i, /\/kids\//i, /\/childrens\//i,
      /\/outerwear\//i, /\/dresses\//i, /\/tops\//i, /\/bottoms\//i,
      /\/shoes\//i, /\/footwear\//i, /\/sneakers\//i, /\/boots\//i,

      // Electronics & Tech
      /\/electronics\//i, /\/computers\//i, /\/laptops\//i, /\/tablets\//i,
      /\/smartphones\//i, /\/phones\//i, /\/accessories\//i,
      /\/gaming\//i, /\/consoles\//i, /\/components\//i,

      // Home & Living
      /\/furniture\//i, /\/home-decor\//i, /\/appliances\//i,
      /\/kitchen\//i, /\/bedroom\//i, /\/living-room\//i,
      /\/outdoor-living\//i, /\/garden\//i, /\/patio\//i,

      // Jewelry & Watches
      /\/jewelry\//i, /\/jewellery\//i, /\/watches\//i,
      /\/rings\//i, /\/necklaces\//i, /\/bracelets\//i, /\/earrings\//i,

      // Beauty & Personal Care
      /\/beauty\//i, /\/cosmetics\//i, /\/skincare\//i, /\/makeup\//i,
      /\/fragrance\//i, /\/perfumes\//i, /\/haircare\//i,

      // Sports & Fitness
      /\/sports\//i, /\/fitness\//i, /\/outdoor\//i, /\/activewear\//i,
      /\/gym\//i, /\/equipment\//i, /\/gear\//i,

      // Books & Media
      /\/books\//i, /\/ebooks\//i, /\/audiobooks\//i, /\/magazines\//i,
      /\/movies\//i, /\/music\//i, /\/dvds\//i,

      // Toys & Games
      /\/toys\//i, /\/games\//i, /\/puzzles\//i, /\/collectibles\//i,
      /\/action-figures\//i, /\/dolls\//i, /\/board-games\//i,

      // Pet Supplies
      /\/pet-supplies\//i, /\/pets\//i, /\/dog\//i, /\/cat\//i,
      /\/pet-food\//i, /\/pet-toys\//i, /\/aquarium\//i,

      // Health & Wellness
      /\/health\//i, /\/wellness\//i, /\/vitamins\//i, /\/supplements\//i,
      /\/nutrition\//i, /\/pharmacy\//i,

      // Baby & Kids
      /\/baby\//i, /\/nursery\//i, /\/maternity\//i, /\/toddler\//i,
      /\/baby-gear\//i, /\/strollers\//i, /\/car-seats\//i,

      // Office & Stationery
      /\/office\//i, /\/stationery\//i, /\/supplies\//i, /\/paper\//i,

      // Food & Beverage
      /\/food\//i, /\/beverages\//i, /\/drinks\//i, /\/snacks\//i,
      /\/groceries\//i, /\/organic\//i, /\/wine\//i, /\/beer\//i,

      // Musical Instruments
      /\/instruments\//i, /\/guitars\//i, /\/pianos\//i, /\/drums\//i,
      /\/audio-equipment\//i,

      // Art & Crafts
      /\/art\//i, /\/crafts\//i, /\/supplies\//i, /\/materials\//i,
      /\/painting\//i, /\/drawing\//i, /\/sewing\//i,

      // Industrial & Scientific
      /\/industrial\//i, /\/scientific\//i, /\/lab-equipment\//i,
      /\/safety\//i, /\/tools\//i, /\/machinery\//i
    ];

    if (plpPatterns.some(pattern => pattern.test(pathname))) {
      category = this.categories.PRODUCT_LISTING;
      confidence = 0.85;
      indicators.push('plp_pattern_match');

      // Check if it might be a specific product (has more path segments after products)
      if (pathSegments.length > 2 && !pathname.endsWith('/')) {
        // Might be PDP, lower confidence for PLP
        confidence = 0.7;
        subCategory = 'deep_product_path';
      }

      return { category, subCategory, confidence, indicators };
    }

    // Specification-based category pages (e.g., /tv-by-inch/218cm-86-inch-and-larger-tvs/)
    // These URLs have size/spec information and end with plural product types or descriptive category names
    // CHECK BEFORE PDP patterns to avoid false positives
    const lastSegment = pathSegments.length > 0 ? pathSegments[pathSegments.length - 1].toLowerCase() : '';

    // Check if last segment is a model code (alphanumeric without spaces, typically 8-15 chars)
    // Model codes like: 86nano85a6a, oled65c56la, iphone-14-pro
    // These should NOT be caught by this PLP check
    const isModelCode = /^[a-z0-9]{8,15}$/i.test(lastSegment) && /[a-z]/i.test(lastSegment) && /\d/.test(lastSegment);

    // Only proceed with PLP check if it's NOT a model code
    if (!isModelCode) {
      // Check if URL ends with plural product types with specifications
      const pluralProductTypes = /-(tvs|monitors|laptops|phones|tablets|cameras|speakers|printers|routers)$/i;
      const hasSpecifications = /\d+(cm|inch|mm|gb|tb|k|hz|mp|w|ghz)[-\s]/i.test(pathname);
      const hasFilteringTerms = /(by-inch|by-size|2-in-1|3-in-1|uhd|4k|5k|8k|hd|fhd|qhd)/i.test(pathname);
      const hasDescriptiveEnding = /(and-larger|and-smaller|and-above|and-below)[-\s]/i.test(pathname);

      if (pluralProductTypes.test(lastSegment) || hasDescriptiveEnding ||
          (hasSpecifications && pathSegments.length >= 2) || hasFilteringTerms) {
        category = this.categories.PRODUCT_LISTING;
        confidence = 0.88;
        indicators.push('specification_based_category');
        subCategory = 'filtered_by_specs';
        return { category, subCategory, confidence, indicators };
      }
    }

    // Model code detection for PDP (e.g., /tv-soundbars/nanocell/86nano85a6a/, /oled-evo/oled65c56la/)
    // Model codes are alphanumeric strings (8-15 chars) that combine letters and numbers
    // Examples: 86nano85a6a, oled65c56la, sm-g998b, iphone14pro
    if (pathSegments.length >= 2 && lastSegment.length >= 8 && lastSegment.length <= 15) {
      // Check if it's a model code: has both letters and numbers, no spaces
      if (/^[a-z0-9]+$/i.test(lastSegment) && /[a-z]/i.test(lastSegment) && /\d/.test(lastSegment)) {
        category = this.categories.PRODUCT_DETAIL;
        confidence = 0.87;
        indicators.push('model_code_pattern');
        subCategory = 'model_code';
        return { category, subCategory, confidence, indicators };
      }
    }

    // Brand-based Product Detail Page detection
    // Common tech/retail brands in URL structure like /apple/iphone-7, /samsung/galaxy-s25
    const commonBrands = [
      'apple', 'samsung', 'lenovo', 'dell', 'hp', 'asus', 'acer', 'microsoft',
      'sony', 'lg', 'panasonic', 'canon', 'nikon', 'gopro', 'fitbit', 'garmin',
      'nike', 'adidas', 'puma', 'reebok', 'under-armour', 'underarmour',
      'levi', 'levis', 'guess', 'zara', 'h&m', 'gap', 'uniqlo',
      'bosch', 'siemens', 'whirlpool', 'ge', 'kenmore', 'dyson',
      'intel', 'amd', 'nvidia', 'logitech', 'razer', 'corsair',
      'bose', 'jbl', 'harman', 'beats', 'sennheiser', 'audio-technica'
    ];

    // Check for brand-based URL structure
    if (pathSegments.length >= 2) {
      const firstSegment = pathSegments[0].toLowerCase();
      const hasModelPattern = pathSegments[pathSegments.length - 1].match(/[\w-]+([-_]\w+)+|[a-z]+\d+[\w-]*/i);

      // If first segment is a brand and we have a model-like pattern
      if (commonBrands.includes(firstSegment) && hasModelPattern) {
        category = this.categories.PRODUCT_DETAIL;
        confidence = 0.85;
        indicators.push('brand_model_pattern');
        subCategory = 'brand_based_url';
        return { category, subCategory, confidence, indicators };
      }

      // Check for deep path with specific product indicators (3+ segments with model numbers/names)
      if (pathSegments.length >= 3) {
        const lastSegment = pathSegments[pathSegments.length - 1].toLowerCase();

        // Product-specific patterns: model numbers, colors, sizes, variants
        const productIndicators = [
          /\d{4,}/,  // Model numbers like "iphone-14-pro", "galaxy-s24"
          /-(pro|plus|max|ultra|mini|lite|air|studio|edge|note)$/i,  // Product variants
          /-(black|white|silver|gold|blue|red|green|purple|pink|gray|grey)$/i,  // Colors
          /-(64gb|128gb|256gb|512gb|1tb|2tb)$/i,  // Storage
          /^[a-z]+-\d+/i,  // Pattern like "laptop-15", "monitor-27"
          /\d+[-.]?\d*\s*(inch|in|gb|tb|mp|hz|ghz|w|watt)/i  // Specs
        ];

        if (productIndicators.some(pattern => pattern.test(lastSegment))) {
          category = this.categories.PRODUCT_DETAIL;
          confidence = 0.8;
          indicators.push('product_specification_pattern');
          subCategory = 'deep_product_path';
          return { category, subCategory, confidence, indicators };
        }
      }
    }

    // Enhanced brand-based category detection (e.g., /apple/, /samsung/ without product)
    // Only 1-2 segments = likely category page, not product page
    // CHECK THIS BEFORE long_id_pattern to avoid false positives
    if (pathSegments.length === 1 || (pathSegments.length === 2 && pathname.endsWith('/'))) {
      const segment = pathSegments[0].toLowerCase();

      // Check if it's a brand without specific product
      if (commonBrands.includes(segment)) {
        category = this.categories.PRODUCT_LISTING;
        confidence = 0.8;
        indicators.push('brand_category_page');
        subCategory = 'brand_landing';
        return { category, subCategory, confidence, indicators };
      }

      // Common category keywords - EXPANDED list
      const categoryKeywords = [
        // Electronics & Tech
        'electronics', 'computers', 'laptops', 'phones', 'smartphones', 'tablets',
        'headphones', 'earphones', 'earbuds', 'speakers', 'audio', 'cameras',
        'monitors', 'keyboards', 'mice', 'printers', 'scanners', 'projectors',
        'routers', 'networking', 'storage', 'cables', 'chargers', 'batteries',
        'components', 'gadgets', 'wearables',

        // Fashion & Apparel
        'clothing', 'apparel', 'shoes', 'footwear', 'sneakers', 'boots', 'sandals',
        'accessories', 'watches', 'jewelry', 'jewellery', 'bags', 'handbags', 'backpacks',
        'sunglasses', 'belts', 'hats', 'caps', 'scarves', 'gloves',
        'dresses', 'tops', 'bottoms', 'jeans', 'pants', 'shirts', 'jackets',
        'coats', 'outerwear', 'activewear', 'sportswear', 'underwear', 'socks',
        'fashion', 'wear', 'mens', 'womens', 'kids', 'childrens',

        // Home & Living
        'home', 'furniture', 'kitchen', 'appliances', 'tools', 'garden',
        'bedding', 'bath', 'decor', 'lighting', 'rugs', 'curtains',
        'bedroom', 'living-room', 'dining', 'outdoor-living', 'patio',

        // Sports & Outdoor & Bikes
        'sports', 'fitness', 'outdoor', 'camping', 'hiking', 'cycling',
        'running', 'gym', 'exercise', 'yoga', 'swimming', 'climbing',
        'bikes', 'bicycles', 'cycles', 'ebikes', 'e-bikes', 'scooters',
        'equipment', 'gear', 'sportfit',

        // Automotive
        'cars', 'vehicles', 'automobiles', 'autos', 'motorcycles', 'trucks',
        'auto-parts', 'tires', 'wheels', 'automotive',

        // Education & Training
        'courses', 'training', 'certifications', 'qualifications', 'programs',
        'workshops', 'seminars', 'learning', 'education', 'classes',

        // Services
        'services', 'solutions', 'consulting',

        // Healthcare & Medical
        'doctors', 'physicians', 'treatments', 'specialties', 'clinics',
        'hospitals', 'medical', 'healthcare', 'dental', 'pharmacy',

        // Real Estate
        'properties', 'listings', 'homes', 'apartments', 'rentals',
        'realestate', 'housing',

        // Travel & Hospitality
        'hotels', 'destinations', 'packages', 'tours', 'flights',
        'cruises', 'resorts', 'vacations', 'travel',

        // Food & Restaurants
        'restaurants', 'locations', 'menu', 'dining', 'catering',
        'food', 'beverages', 'drinks', 'groceries', 'snacks',

        // Media & Entertainment
        'movies', 'shows', 'videos', 'music', 'podcasts', 'episodes',
        'series', 'films', 'entertainment', 'streaming', 'books', 'ebooks',

        // Beauty & Personal Care
        'beauty', 'cosmetics', 'skincare', 'makeup', 'haircare', 'fragrance',
        'perfumes', 'cologne', 'grooming',

        // Jewelry & Watches
        'rings', 'necklaces', 'bracelets', 'earrings', 'charms',

        // Toys & Games
        'toys', 'games', 'gaming', 'consoles', 'puzzles', 'collectibles',
        'action-figures', 'dolls', 'board-games',

        // Pet Supplies
        'pets', 'petcare', 'dogs', 'cats', 'pet-supplies', 'pet-food',
        'pet-toys', 'aquarium',

        // Health & Wellness
        'health', 'wellness', 'vitamins', 'supplements', 'nutrition',

        // Baby & Kids
        'baby', 'kids', 'children', 'infants', 'toddlers', 'nursery',
        'maternity', 'baby-gear', 'strollers', 'car-seats',

        // Office & Stationery
        'office', 'stationery', 'supplies', 'paper',

        // Musical Instruments
        'instruments', 'guitars', 'pianos', 'drums', 'audio-equipment',

        // Art & Crafts
        'art', 'crafts', 'materials', 'painting', 'drawing', 'sewing',

        // Industrial & Scientific
        'industrial', 'scientific', 'lab-equipment', 'safety', 'machinery',

        // Shopping Categories
        'new', 'sale', 'clearance', 'deals', 'specials', 'offers',
        'trending', 'popular', 'bestsellers', 'featured', 'express',
        'inventory', 'collection', 'catalog'
      ];

      if (categoryKeywords.includes(segment)) {
        category = this.categories.PRODUCT_LISTING;
        confidence = 0.85;
        indicators.push('category_keyword');
        subCategory = 'category_name';
        return { category, subCategory, confidence, indicators };
      }
    }

    // Check if last segment is a category keyword for multi-segment URLs
    // This catches URLs like /headphones/ontrac/accessories or /shop/electronics/cameras
    if (pathSegments.length >= 2) {
      const lastSegment = pathSegments[pathSegments.length - 1].toLowerCase();

      // Same category keywords list as above
      const categoryKeywords = [
        // Electronics & Tech
        'electronics', 'computers', 'laptops', 'phones', 'smartphones', 'tablets',
        'headphones', 'earphones', 'earbuds', 'speakers', 'audio', 'cameras',
        'monitors', 'keyboards', 'mice', 'printers', 'scanners', 'projectors',
        'routers', 'networking', 'storage', 'cables', 'chargers', 'batteries',
        'components', 'gadgets', 'wearables',

        // Fashion & Apparel
        'clothing', 'apparel', 'shoes', 'footwear', 'sneakers', 'boots', 'sandals',
        'accessories', 'watches', 'jewelry', 'jewellery', 'bags', 'handbags', 'backpacks',
        'sunglasses', 'belts', 'hats', 'caps', 'scarves', 'gloves',
        'dresses', 'tops', 'bottoms', 'jeans', 'pants', 'shirts', 'jackets',
        'coats', 'outerwear', 'activewear', 'sportswear', 'underwear', 'socks',
        'fashion', 'wear', 'mens', 'womens', 'kids', 'childrens',

        // Home & Living
        'home', 'furniture', 'kitchen', 'appliances', 'tools', 'garden',
        'bedding', 'bath', 'decor', 'lighting', 'rugs', 'curtains',
        'bedroom', 'living-room', 'dining', 'outdoor-living', 'patio',

        // Sports & Outdoor & Bikes
        'sports', 'fitness', 'outdoor', 'camping', 'hiking', 'cycling',
        'running', 'gym', 'exercise', 'yoga', 'swimming', 'climbing',
        'bikes', 'bicycles', 'cycles', 'ebikes', 'e-bikes', 'scooters',
        'equipment', 'gear', 'sportfit',

        // Automotive
        'cars', 'vehicles', 'automobiles', 'autos', 'motorcycles', 'trucks',
        'auto-parts', 'tires', 'wheels', 'automotive',

        // Education & Training
        'courses', 'training', 'certifications', 'qualifications', 'programs',
        'workshops', 'seminars', 'learning', 'education', 'classes',

        // Services
        'services', 'solutions', 'consulting',

        // Healthcare & Medical
        'doctors', 'physicians', 'treatments', 'specialties', 'clinics',
        'hospitals', 'medical', 'healthcare', 'dental', 'pharmacy',

        // Real Estate
        'properties', 'listings', 'homes', 'apartments', 'rentals',
        'realestate', 'housing',

        // Travel & Hospitality
        'hotels', 'destinations', 'packages', 'tours', 'flights',
        'cruises', 'resorts', 'vacations', 'travel',

        // Food & Restaurants
        'restaurants', 'locations', 'menu', 'dining', 'catering',
        'food', 'beverages', 'drinks', 'groceries', 'snacks',

        // Media & Entertainment
        'movies', 'shows', 'videos', 'music', 'podcasts', 'episodes',
        'series', 'films', 'entertainment', 'streaming', 'books', 'ebooks',

        // Beauty & Personal Care
        'beauty', 'cosmetics', 'skincare', 'makeup', 'haircare', 'fragrance',
        'perfumes', 'cologne', 'grooming',

        // Jewelry & Watches
        'rings', 'necklaces', 'bracelets', 'earrings', 'charms',

        // Toys & Games
        'toys', 'games', 'gaming', 'consoles', 'puzzles', 'collectibles',
        'action-figures', 'dolls', 'board-games',

        // Pet Supplies
        'pets', 'petcare', 'dogs', 'cats', 'pet-supplies', 'pet-food',
        'pet-toys', 'aquarium',

        // Health & Wellness
        'health', 'wellness', 'vitamins', 'supplements', 'nutrition',

        // Baby & Kids
        'baby', 'kids', 'children', 'infants', 'toddlers', 'nursery',
        'maternity', 'baby-gear', 'strollers', 'car-seats',

        // Office & Stationery
        'office', 'stationery', 'supplies', 'paper',

        // Musical Instruments
        'instruments', 'guitars', 'pianos', 'drums', 'audio-equipment',

        // Art & Crafts
        'art', 'crafts', 'materials', 'painting', 'drawing', 'sewing',

        // Industrial & Scientific
        'industrial', 'scientific', 'lab-equipment', 'safety', 'machinery',

        // Shopping Categories
        'new', 'sale', 'clearance', 'deals', 'specials', 'offers',
        'trending', 'popular', 'bestsellers', 'featured', 'express',
        'inventory', 'collection', 'catalog'
      ];

      if (categoryKeywords.includes(lastSegment)) {
        category = this.categories.PRODUCT_LISTING;
        confidence = 0.8;
        indicators.push('category_keyword_in_path');
        subCategory = 'deep_category_path';
        return { category, subCategory, confidence, indicators };
      }
    }

    // URL with long alphanumeric string (likely product ID)
    // Only match if it's purely alphanumeric/numeric with NO hyphens (to avoid category names)
    // This should be checked AFTER category keywords to avoid false positives
    // More restrictive: require at least 12 chars and must contain numbers
    if (/\/[A-Z0-9]{12,}$/i.test(pathname) && /\d/.test(pathname.split('/').pop())) {
      category = this.categories.PRODUCT_DETAIL;
      confidence = 0.7;  // Lower confidence since this is a fallback pattern
      indicators.push('long_id_pattern');
      subCategory = 'unique_identifier';
      return { category, subCategory, confidence, indicators };
    }

    // Query parameter based category/listing detection
    if (searchParams.has('category') || searchParams.has('cat') ||
        searchParams.has('dept') || searchParams.has('department') ||
        searchParams.has('filter') || searchParams.has('sort') ||
        searchParams.has('page') && !searchParams.has('q')) {
      category = this.categories.PRODUCT_LISTING;
      confidence = 0.75;
      indicators.push('category_query_params');
      subCategory = 'filtered_listing';
      return { category, subCategory, confidence, indicators };
    }

    // Improved fallback logic - Use domain indicators to make better guesses
    if (category === this.categories.OTHER && confidence < 0.7) {
      // If we detected domain type but couldn't categorize the page, use context
      if (indicators.includes('healthcare_domain')) {
        // Healthcare sites with deep paths are likely service pages
        if (pathSegments.length >= 2) {
          category = this.categories.PRODUCT_DETAIL;
          confidence = 0.65;
          subCategory = 'healthcare_page';
          indicators.push('fallback_healthcare_context');
          return { category, subCategory, confidence, indicators };
        }
      }

      if (indicators.includes('realestate_domain')) {
        // Real estate with deep paths are likely property listings or details
        if (pathSegments.length >= 2) {
          // If path has numbers (like property ID), it's likely a detail page
          if (/\d{5,}/.test(pathname)) {
            category = this.categories.PRODUCT_DETAIL;
            confidence = 0.65;
            subCategory = 'property_detail';
            indicators.push('fallback_realestate_id');
          } else {
            category = this.categories.PRODUCT_LISTING;
            confidence = 0.6;
            subCategory = 'property_listing';
            indicators.push('fallback_realestate_listing');
          }
          return { category, subCategory, confidence, indicators };
        }
      }

      if (indicators.includes('travel_domain')) {
        // Travel sites with query params are often search results
        if (searchParams.size > 0) {
          category = this.categories.SEARCH_RESULTS;
          confidence = 0.65;
          subCategory = 'travel_search';
          indicators.push('fallback_travel_search');
          return { category, subCategory, confidence, indicators };
        }
      }

      if (indicators.includes('food_domain')) {
        // Food/restaurant sites with location paths
        if (/\/(order|menu|delivery)/i.test(pathname)) {
          category = this.categories.PRODUCT_LISTING;
          confidence = 0.65;
          subCategory = 'menu_ordering';
          indicators.push('fallback_food_ordering');
          return { category, subCategory, confidence, indicators };
        }
      }

      // Generic fallback: Deep paths (3+ segments) on commercial domains might be product details
      if (pathSegments.length >= 3 && !indicators.includes('non_commerce_domain')) {
        const hasIdPattern = /\d{4,}|[a-z0-9]{10,}/i.test(lastSegment);
        if (hasIdPattern) {
          category = this.categories.PRODUCT_DETAIL;
          confidence = 0.55;
          subCategory = 'deep_path_with_id';
          indicators.push('fallback_deep_path_id');
          return { category, subCategory, confidence, indicators };
        }
      }
    }

    // Check if external domain (for comparison)
    indicators.push('no_pattern_match');

    return { category, subCategory, confidence, indicators };
  }

  /**
   * Fetch page HTML using Puppeteer to avoid bot detection
   * Uses existing helper functions for robust page fetching
   * @param {string} url - URL to fetch
   * @param {number} timeout - Navigation timeout in milliseconds
   * @returns {Promise<string>} HTML content of the page
   */
  async fetchPageWithPuppeteer(url, timeout = 30000) {
    let browser = null;
    try {
      console.log(`🌐 Fetching page with Puppeteer: ${url}`);

      // Launch browser using helper
      browser = await launchBrowser();

      // Create new page
      const page = await createPage(browser);

      // Navigate to URL with robust error handling
      await navigateToPage(page, url);

      // Handle cookie consent automatically
      console.log(`🍪 Handling cookie consent...`);
      const cookieType = await handleCookieConsent(page);
      console.log(`Cookie consent handled: ${cookieType}`);

      // Wait a bit for any dynamic content to load
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check for captcha
      console.log(`🔍 Checking for captcha...`);
      const captchaResult = await detectCaptcha(page);
      if (captchaResult.detected) {
        console.warn(`⚠️  Captcha detected: ${captchaResult.reason}`);
        throw new Error(`Captcha detected on ${url}: ${captchaResult.reason}`);
      }

      // Get HTML content
      const html = await page.content();
      console.log(`✅ Successfully fetched HTML from ${url} (${html.length} bytes)`);

      return html;

    } catch (error) {
      console.error(`❌ Error fetching page with Puppeteer for ${url}:`, error.message);
      throw error;
    } finally {
      // Always close browser
      if (browser) {
        await closeBrowser(browser);
      }
    }
  }

  /**
   * Analyze page content for better categorization
   * Uses Puppeteer first, falls back to Browserless BQL if captcha detected
   * @param {string} url - URL to analyze
   * @param {number} timeout - Fetch timeout in milliseconds
   * @returns {Promise<Object>} Content analysis result
   */
  async analyzePageContent(url, timeout = 30000) {
    let html = '';
    let fetchMethod = 'puppeteer';

    try {
      // Try Puppeteer first (free and fast)
      console.log(`🤖 Attempting to fetch with Puppeteer: ${url}`);
      html = await this.fetchPageWithPuppeteer(url, timeout);
    } catch (puppeteerError) {
      // Check if error is due to captcha detection
      if (puppeteerError.message && puppeteerError.message.includes('Captcha detected')) {
        console.warn(`🚨 Captcha detected! Switching to Browserless BQL: ${url}`);
        fetchMethod = 'browserless';

        try {
          // Use Browserless to bypass captcha
          html = await browserlessService.fetchPageContent(url, timeout);
        } catch (browserlessError) {
          console.error(`❌ Both Puppeteer and Browserless failed for ${url}`);
          throw new Error(`Captcha bypass failed: ${browserlessError.message}`);
        }
      } else {
        // If not a captcha issue, just throw the original error
        throw puppeteerError;
      }
    }

    try {
      console.log(`✅ Content fetched using ${fetchMethod}`);

      // Parse with Cheerio (fast and efficient)
      const $ = cheerio.load(html);

      // Remove script and style elements
      $('script, style, noscript').remove();

      // Get page title and meta description
      const title = $('title').text().toLowerCase();
      const metaDescription = $('meta[name="description"]').attr('content')?.toLowerCase() || '';
      const bodyText = $('body').text().toLowerCase().replace(/\s+/g, ' ').trim();

      // Analyze content
      const analysis = {
        hasAddToCart: this.checkForPattern(bodyText, ['add to cart', 'add to bag', 'buy now', 'purchase']),
        hasPrice: this.checkForPattern(bodyText, ['$', '£', '€', 'price', 'was:', 'now:']),
        hasProductInfo: this.checkForPattern(bodyText, ['size', 'color', 'quantity', 'sku', 'in stock']),
        hasCheckoutElements: this.checkForPattern(bodyText, ['shipping address', 'payment method', 'billing', 'place order']),
        hasCartElements: this.checkForPattern(bodyText, ['shopping cart', 'cart total', 'subtotal', 'remove item']),
        hasSearchResults: this.checkForPattern(bodyText, ['results for', 'showing', 'items found', 'filter by']),
        hasLoginForm: $('input[type="password"]').length > 0 && $('form').length > 0,
        productCount: $('.product, .item, [data-product]').length,
        imageCount: $('img').length
      };

      // Determine category based on content analysis
      let category = this.categories.OTHER;
      let confidence = 0.6;

      if (analysis.hasCheckoutElements) {
        category = this.categories.CHECKOUT;
        confidence = 0.85;
      } else if (analysis.hasCartElements) {
        category = this.categories.CART;
        confidence = 0.85;
      } else if (analysis.hasAddToCart && analysis.hasPrice && analysis.hasProductInfo) {
        category = this.categories.PRODUCT_DETAIL;
        confidence = 0.8;
      } else if (analysis.productCount > 3 && analysis.hasSearchResults) {
        category = this.categories.SEARCH_RESULTS;
        confidence = 0.75;
      } else if (analysis.productCount > 5) {
        category = this.categories.PRODUCT_LISTING;
        confidence = 0.7;
      } else if (analysis.hasLoginForm) {
        category = this.categories.LOGIN;
        confidence = 0.75;
      }

      return {
        category,
        confidence,
        analysis
      };

    } catch (error) {
      console.error(`Error fetching content for ${url}:`, error.message);
      return {
        category: this.categories.OTHER,
        confidence: 0,
        analysis: {},
        error: error.message
      };
    }
  }

  /**
   * Check if text contains any of the patterns
   * @param {string} text - Text to search
   * @param {Array<string>} patterns - Patterns to look for
   * @returns {boolean} True if any pattern is found
   */
  checkForPattern(text, patterns) {
    return patterns.some(pattern => text.includes(pattern));
  }

  /**
   * Categorize multiple URLs in batch with OpenAI fallback support
   * @param {Array<string>} urls - Array of URLs to categorize
   * @param {Object} options - Categorization options
   * @returns {Promise<Array>} Array of categorization results
   */
  async categorizeUrls(urls, options = {}) {
    const {
      analyzeContent = false,
      concurrency = 5, // Number of URLs to process concurrently
      onProgress = null,
      useOpenAIFallback = true, // Enable OpenAI fallback by default
      baseUrl = null // Base URL for OpenAI fallback if urls array is empty
    } = options;

    console.log(`🔍 Starting batch categorization of ${urls.length} URLs`);
    console.log(`⚙️ Options: analyzeContent=${analyzeContent}, concurrency=${concurrency}, useOpenAIFallback=${useOpenAIFallback}`);

    // Check if URLs array is empty and OpenAI fallback is enabled
    if (urls.length === 0 && useOpenAIFallback && baseUrl) {
      console.log(`⚠️  Empty URLs array detected. Activating OpenAI fallback...`);
      return await this.categorizeWithOpenAI(baseUrl, options);
    }

    // If empty URLs and no baseUrl provided, return empty results
    if (urls.length === 0) {
      console.log(`⚠️  Empty URLs array and no baseUrl provided for fallback`);
      return {
        results: [],
        summary: {
          totalUrls: 0,
          categoryCounts: {},
          averageConfidence: '0.00',
          highConfidencePercentage: '0.0%'
        },
        totalUrls: 0,
        timestamp: new Date().toISOString()
      };
    }

    const results = [];
    const batches = this.createBatches(urls, concurrency);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`📦 Processing batch ${i + 1}/${batches.length} (${batch.length} URLs)`);

      const batchResults = await Promise.allSettled(
        batch.map(url => this.categorizeUrl(url, { analyzeContent }))
      );

      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            url: batch[index],
            category: this.categories.OTHER,
            confidence: 0,
            error: result.reason.message
          });
        }
      });

      // Call progress callback
      if (onProgress && typeof onProgress === 'function') {
        onProgress({
          processed: results.length,
          total: urls.length,
          progress: (results.length / urls.length) * 100
        });
      }

      // Small delay between batches to avoid overwhelming the system
      if (i < batches.length - 1 && analyzeContent) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Generate summary statistics
    const summary = this.generateSummary(results);

    console.log(`✅ Batch categorization completed!`);
    console.log(`📊 Summary:`, summary);

    return {
      results,
      summary,
      totalUrls: urls.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Create batches from array
   * @param {Array} array - Array to batch
   * @param {number} batchSize - Size of each batch
   * @returns {Array<Array>} Array of batches
   */
  createBatches(array, batchSize) {
    const batches = [];
    for (let i = 0; i < array.length; i += batchSize) {
      batches.push(array.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * Generate summary statistics from categorization results
   * @param {Array} results - Categorization results
   * @returns {Object} Summary statistics
   */
  generateSummary(results) {
    const categoryCounts = {};
    let totalConfidence = 0;
    let highConfidenceCount = 0;

    results.forEach(result => {
      // Count categories
      categoryCounts[result.category] = (categoryCounts[result.category] || 0) + 1;

      // Track confidence
      totalConfidence += result.confidence;
      if (result.confidence >= 0.8) {
        highConfidenceCount++;
      }
    });

    return {
      totalUrls: results.length,
      categoryCounts,
      averageConfidence: (totalConfidence / results.length).toFixed(2),
      highConfidencePercentage: ((highConfidenceCount / results.length) * 100).toFixed(1) + '%'
    };
  }

  /**
   * Extract product detail page URLs from a product listing page
   * Uses Puppeteer first, falls back to Browserless BQL if captcha detected
   * @param {string} plpUrl - Product listing page URL
   * @param {number} maxProducts - Maximum number of product URLs to extract
   * @returns {Promise<Array<string>>} Array of product URLs
   */
  async extractProductUrlsFromPLP(plpUrl, maxProducts = 20) {
    try {
      console.log(`🔍 Extracting product URLs from PLP: ${plpUrl}`);

      let html = '';
      let usedBrowserless = false;

      try {
        // Try Puppeteer first (free and fast)
        console.log(`🤖 Attempting to fetch PLP with Puppeteer`);
        html = await this.fetchPageWithPuppeteer(plpUrl, 30000);
      } catch (puppeteerError) {
        // Check if error is due to captcha detection
        if (puppeteerError.message && puppeteerError.message.includes('Captcha detected')) {
          console.warn(`🚨 Captcha detected on PLP! Switching to Browserless BQL`);
          usedBrowserless = true;

          try {
            // Use Browserless to bypass captcha and extract products directly
            const productUrls = await browserlessService.extractProductLinks(plpUrl, maxProducts);

            if (productUrls.length > 0) {
              console.log(`✅ Extracted ${productUrls.length} product URLs using Browserless (captcha bypass)`);
              return productUrls;
            }

            console.log(`⚠️  Browserless returned no products, trying to fetch HTML`);
            html = await browserlessService.fetchPageContent(plpUrl, 30000);
          } catch (browserlessError) {
            console.error(`❌ Browserless captcha bypass failed: ${browserlessError.message}`);
            throw new Error(`Failed to extract products: Captcha detected and bypass failed`);
          }
        } else {
          // If not a captcha issue, throw the original error
          throw puppeteerError;
        }
      }

      // Parse with Cheerio (fast and efficient)
      const $ = cheerio.load(html);
      const baseUrl = new URL(plpUrl);
      const productUrls = new Set();

      // Common selectors for product links in PLPs
      const productLinkSelectors = [
        'a[href*="/product/"]',
        'a[href*="/p/"]',
        'a[href*="/item/"]',
        'a[href*="/pd/"]',
        'a[href*="/dp/"]',
        '.product a[href]',
        '.product-item a[href]',
        '.product-card a[href]',
        '[data-product] a[href]',
        '.item a[href]',
        '[class*="product"] a[href]',
        '[class*="item"] a[href]'
      ];

      // Extract all product links
      productLinkSelectors.forEach(selector => {
        $(selector).each((index, element) => {
          if (productUrls.size >= maxProducts) return false; // Stop if we have enough

          let href = $(element).attr('href');
          if (!href) return;

          // Handle relative URLs
          try {
            const absoluteUrl = new URL(href, baseUrl.origin);

            // Only include URLs from the same domain
            if (absoluteUrl.hostname === baseUrl.hostname) {
              productUrls.add(absoluteUrl.href);
            }
          } catch (error) {
            // Skip invalid URLs
          }
        });
      });

      const extractedUrls = Array.from(productUrls).slice(0, maxProducts);
      const method = usedBrowserless ? 'Browserless (captcha bypass)' : 'Puppeteer';
      console.log(`✅ Extracted ${extractedUrls.length} product URLs from PLP using ${method}`);

      return extractedUrls;

    } catch (error) {
      console.error(`❌ Error extracting product URLs from ${plpUrl}:`, error.message);
      return [];
    }
  }

  /**
   * OpenAI-based URL categorization fallback
   * Uses OpenAI API to crawl and categorize website pages when primary method fails
   * @param {string} url - Base URL to analyze
   * @param {Object} options - Options for OpenAI categorization
   * @returns {Promise<Object>} Categorization results with URLs
   */
  async categorizeWithOpenAI(url, options = {}) {
    const {
      maxTokens = 400,
      temperature = 0.3,
      model = 'gpt-4o-mini'
    } = options;

    try {
      console.log(`\n🤖 Using OpenAI fallback for URL categorization: ${url}`);

      // Get OpenAI API key from environment
      const openaiApiKey = process.env.OPENAI_API_KEY;
      if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY not found in environment variables');
      }

      // Parse the domain from URL to determine site type
      const urlObj = new URL(url);
      const domain = urlObj.hostname;

      // System prompt for OpenAI
      const systemPrompt = `You are a web architecture analyst specializing in identifying critical user journey pages. Based on the domain type, identify the 5 most important functional pages:

For E-commerce sites: Prioritize PLP (Product Listing Page), PDP (Product Detail Page), Cart, Checkout, and Account/Login pages. Avoid generic pages like About, Contact, or Membership.

For Hotel/Travel booking sites: Prioritize Search/Listing page, Property/Hotel details, Booking page, Payment/Checkout, and Account pages.

For SaaS/Service sites: Prioritize Pricing, Product demo, Sign-up/Registration, Dashboard/Login, and Documentation.

For Media/News sites: Prioritize Article listing, Article detail, Search, Category pages, and User profile.

Always focus on pages in the critical user conversion funnel. Categorize each URL clearly (e.g., PLP, PDP, Cart, Checkout) and provide the full URL. Respond in JSON format only.`;

      // User prompt
      const userPrompt = `Analyze this URL and identify the domain type, then extract the 5 most critical user journey URLs with proper categories: ${url}`;

      // Call OpenAI API
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: model,
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          max_tokens: maxTokens,
          temperature: temperature,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiApiKey}`
          },
          timeout: 30000
        }
      );

      // Parse OpenAI response
      const openaiResult = JSON.parse(response.data.choices[0].message.content);
      console.log(`✅ OpenAI response received:`, JSON.stringify(openaiResult, null, 2));

      // Transform OpenAI result to match our categorization format
      return this.transformOpenAIResponse(openaiResult, url);

    } catch (error) {
      console.error(`❌ OpenAI categorization failed for ${url}:`, error.message);
      return {
        results: [],
        summary: {
          totalUrls: 0,
          categoryCounts: {},
          averageConfidence: '0.00',
          highConfidencePercentage: '0.0%'
        },
        totalUrls: 0,
        timestamp: new Date().toISOString(),
        error: error.message,
        openAIFallback: true
      };
    }
  }

  /**
   * Transform OpenAI response to match our categorization format
   * Maps OpenAI categories to our internal categories
   * @param {Object} openaiResult - OpenAI response object
   * @param {string} baseUrl - Base URL that was analyzed
   * @returns {Object} Categorization results in our format
   */
  transformOpenAIResponse(openaiResult, baseUrl) {
    try {
      // Extract URLs from various possible structures
      let urlsData = [];

      // Try to find URLs in the response (handle different response formats)
      if (openaiResult.urls && Array.isArray(openaiResult.urls)) {
        urlsData = openaiResult.urls;
      } else if (openaiResult.pages && Array.isArray(openaiResult.pages)) {
        urlsData = openaiResult.pages;
      } else if (openaiResult.critical_pages && Array.isArray(openaiResult.critical_pages)) {
        urlsData = openaiResult.critical_pages;
      } else if (openaiResult.user_journey_pages && Array.isArray(openaiResult.user_journey_pages)) {
        urlsData = openaiResult.user_journey_pages;
      } else {
        // Try to extract from top-level keys
        Object.keys(openaiResult).forEach(key => {
          if (Array.isArray(openaiResult[key])) {
            urlsData = openaiResult[key];
          }
        });
      }

      // Category mapping from OpenAI to our internal categories
      const categoryMapping = {
        'plp': this.categories.PRODUCT_LISTING,
        'product_listing': this.categories.PRODUCT_LISTING,
        'product listing page': this.categories.PRODUCT_LISTING,
        'listing': this.categories.PRODUCT_LISTING,
        'search': this.categories.SEARCH_RESULTS,
        'category': this.categories.CATEGORY_PAGE,

        'pdp': this.categories.PRODUCT_DETAIL,
        'product_detail': this.categories.PRODUCT_DETAIL,
        'product detail page': this.categories.PRODUCT_DETAIL,
        'product': this.categories.PRODUCT_DETAIL,
        'property detail': this.categories.PRODUCT_DETAIL,
        'hotel details': this.categories.PRODUCT_DETAIL,

        'cart': this.categories.CART,
        'shopping cart': this.categories.CART,
        'basket': this.categories.CART,

        'checkout': this.categories.CHECKOUT,
        'payment': this.categories.CHECKOUT,
        'billing': this.categories.CHECKOUT,
        'booking': this.categories.CHECKOUT,

        'account': this.categories.ACCOUNT,
        'login': this.categories.LOGIN,
        'signin': this.categories.LOGIN,
        'sign in': this.categories.LOGIN,
        'register': this.categories.REGISTER,
        'signup': this.categories.REGISTER,
        'sign up': this.categories.REGISTER,

        'pricing': this.categories.PRICING,
        'demo': this.categories.OTHER,
        'documentation': this.categories.HELP,
        'dashboard': this.categories.ACCOUNT,

        'article': this.categories.ARTICLE,
        'article detail': this.categories.ARTICLE,
        'profile': this.categories.PROFILE,

        'reviews': this.categories.REVIEWS,
        'review': this.categories.REVIEWS,
        'ratings': this.categories.REVIEWS,
        'rating': this.categories.REVIEWS,
        'testimonials': this.categories.REVIEWS,
        'testimonial': this.categories.REVIEWS,
        'feedback': this.categories.REVIEWS,

        'home': this.categories.HOME,
        'homepage': this.categories.HOME
      };

      const results = [];

      urlsData.forEach(item => {
        let url, category, categoryLabel;

        // Handle different object structures
        if (typeof item === 'string') {
          url = item;
          category = this.categories.OTHER;
          categoryLabel = 'other';
        } else if (typeof item === 'object') {
          url = item.url || item.link || item.page || item.href;
          categoryLabel = (item.category || item.type || item.page_type || '').toLowerCase().trim();

          // Map the category
          category = categoryMapping[categoryLabel] || this.categories.OTHER;
        }

        if (url) {
          results.push({
            url: url,
            category: category,
            subCategory: categoryLabel || 'openai_categorized',
            confidence: 0.85, // OpenAI-based categorization gets a fixed confidence
            patternMatch: null,
            contentMatch: category,
            indicators: ['openai_fallback'],
            metadata: {
              source: 'openai',
              originalCategory: categoryLabel,
              baseUrl: baseUrl
            },
            openAIFallback: true
          });
        }
      });

      console.log(`📊 Transformed ${results.length} URLs from OpenAI response`);

      // Generate summary
      const summary = this.generateSummary(results);

      return {
        results: results,
        summary: summary,
        totalUrls: results.length,
        timestamp: new Date().toISOString(),
        openAIFallback: true,
        domainType: openaiResult.domain_type || openaiResult.site_type || 'unknown'
      };

    } catch (error) {
      console.error(`❌ Error transforming OpenAI response:`, error.message);
      return {
        results: [],
        summary: {
          totalUrls: 0,
          categoryCounts: {},
          averageConfidence: '0.00',
          highConfidencePercentage: '0.0%'
        },
        totalUrls: 0,
        timestamp: new Date().toISOString(),
        error: error.message,
        openAIFallback: true
      };
    }
  }

  /**
   * Discover and categorize product detail pages from product listing pages
   * Called when no PDP pages are found in the initial categorization
   * @param {Array} categorizationResults - Initial categorization results
   * @param {Object} options - Options for discovery
   * @returns {Promise<Object>} Enhanced categorization results with discovered PDPs
   */
  async discoverPDPsFromPLPs(categorizationResults, options = {}) {
    const {
      maxPLPsToCheck = 3,
      maxProductsPerPLP = 10,
      concurrency = 3
    } = options;

    console.log(`\n🔎 Starting PDP discovery from PLPs...`);

    // Check if we have any PDPs in the results
    const pdpCount = categorizationResults.results.filter(r => r.category === this.categories.PRODUCT_DETAIL).length;

    if (pdpCount > 0) {
      console.log(`✅ Found ${pdpCount} PDP pages already. No discovery needed.`);
      return categorizationResults;
    }

    console.log(`⚠️  No PDP pages found in ${categorizationResults.results.length} URLs`);
    console.log(`🔍 Looking for PLP pages to discover products from...`);

    // Find all PLP pages
    const plpPages = categorizationResults.results
      .filter(r => r.category === this.categories.PRODUCT_LISTING)
      .slice(0, maxPLPsToCheck);

    if (plpPages.length === 0) {
      console.log(`❌ No PLP pages found. Cannot discover PDP pages.`);
      return categorizationResults;
    }

    console.log(`📋 Found ${plpPages.length} PLP pages. Extracting product URLs...`);

    // Extract product URLs from each PLP
    const discoveredProductUrls = [];

    for (const plpPage of plpPages) {
      const productUrls = await this.extractProductUrlsFromPLP(plpPage.url, maxProductsPerPLP);
      discoveredProductUrls.push(...productUrls);

      if (discoveredProductUrls.length >= maxPLPsToCheck * maxProductsPerPLP) {
        break; // Stop if we have enough product URLs
      }
    }

    if (discoveredProductUrls.length === 0) {
      console.log(`❌ No product URLs could be extracted from PLP pages`);
      return categorizationResults;
    }

    console.log(`✅ Discovered ${discoveredProductUrls.length} potential product URLs`);
    console.log(`🔍 Categorizing discovered product URLs...`);

    // Categorize the discovered product URLs
    const discoveredResults = await this.categorizeUrls(discoveredProductUrls, {
      analyzeContent: false,
      concurrency: concurrency
    });

    // Count how many PDPs we found
    const discoveredPDPCount = discoveredResults.results.filter(r => r.category === this.categories.PRODUCT_DETAIL).length;

    console.log(`✅ Found ${discoveredPDPCount} PDP pages from discovered URLs`);

    // Merge the results
    const mergedResults = [
      ...categorizationResults.results,
      ...discoveredResults.results.map(r => ({ ...r, discovered: true }))
    ];

    // Regenerate summary
    const mergedSummary = this.generateSummary(mergedResults);

    console.log(`📊 Final summary after PDP discovery:`);
    console.log(`   Total URLs: ${mergedResults.length}`);
    console.log(`   PDP pages: ${mergedSummary.categoryCounts[this.categories.PRODUCT_DETAIL] || 0}`);

    return {
      results: mergedResults,
      summary: mergedSummary,
      totalUrls: mergedResults.length,
      timestamp: new Date().toISOString(),
      pdpDiscovery: {
        enabled: true,
        plpsChecked: plpPages.length,
        urlsDiscovered: discoveredProductUrls.length,
        pdpsFound: discoveredPDPCount
      }
    };
  }

  /**
   * Calculate priority score for a URL based on category and other factors
   * @param {Object} categorizedUrl - Categorized URL object
   * @returns {number} Priority score (1-10)
   */
  calculatePriority(categorizedUrl) {
    const { category, url } = categorizedUrl;

    // Base priority by category (critical path gets highest priority)
    const categoryPriorities = {
      // Critical e-commerce flow (highest priority)
      [this.categories.HOME]: 10,
      [this.categories.CHECKOUT]: 10,
      [this.categories.CART]: 9,
      [this.categories.PRODUCT_DETAIL]: 9,
      [this.categories.PRODUCT_LISTING]: 8,
      [this.categories.CATEGORY_PAGE]: 8,
      [this.categories.SEARCH_RESULTS]: 8,

      // User account flows
      [this.categories.LOGIN]: 7,
      [this.categories.REGISTER]: 7,
      [this.categories.ACCOUNT]: 6,
      [this.categories.PROFILE]: 5,
      [this.categories.ORDERS]: 6,
      [this.categories.WISHLIST]: 5,

      // Pricing & Quotes
      [this.categories.PRICING]: 8,
      [this.categories.QUOTE]: 7,
      [this.categories.INVESTMENT]: 6,

      // Content pages
      [this.categories.BLOG]: 4,
      [this.categories.ARTICLE]: 4,
      [this.categories.REVIEWS]: 5,
      [this.categories.FAQ]: 5,
      [this.categories.HELP]: 5,
      [this.categories.CONTACT]: 6,
      [this.categories.ABOUT]: 3,

      // Legal & Policy (lower priority)
      [this.categories.TERMS]: 2,
      [this.categories.PRIVACY]: 2,
      [this.categories.RETURNS]: 3,
      [this.categories.SHIPPING]: 4,
      [this.categories.ACCESSIBILITY]: 2,

      // Social & External (lowest priority)
      [this.categories.SOCIAL_MEDIA]: 1,
      [this.categories.EXTERNAL]: 1,

      // Other
      [this.categories.OTHER]: 3
    };

    let basePriority = categoryPriorities[category] || 3;

    // Adjust priority based on URL depth (shallower = higher priority)
    try {
      const urlObj = new URL(url);
      const pathDepth = urlObj.pathname.split('/').filter(p => p.length > 0).length;

      if (pathDepth === 0) {
        basePriority += 1; // Homepage gets +1 boost
      } else if (pathDepth > 4) {
        basePriority -= 1; // Deep pages get -1 penalty
      }
    } catch (error) {
      // Invalid URL, keep base priority
    }

    // Ensure priority stays within 1-10 range
    return Math.max(1, Math.min(10, basePriority));
  }

  /**
   * Enrich categorized URLs with priority scores
   * @param {Array} categorizedUrls - Array of categorized URL objects
   * @returns {Array} Enriched URLs with priority scores
   */
  enrichWithPriority(categorizedUrls) {
    return categorizedUrls.map(urlObj => ({
      ...urlObj,
      priority: this.calculatePriority(urlObj)
    }));
  }

  /**
   * Complete URL processing: Categorize + Prioritize + Sort
   * @param {Array<string>} urls - Array of URLs to process
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processed and enriched URLs
   */
  async categorizeAndPrioritize(urls, options = {}) {
    const {
      analyzeContent = false,
      concurrency = 5,
      sortByPriority = true
    } = options;

    console.log(`\n🔍 Starting categorization and prioritization for ${urls.length} URLs...`);

    // Step 1: Categorize all URLs
    const categorizationResult = await this.categorizeUrls(urls, {
      analyzeContent,
      concurrency
    });

    // Step 2: Add priority scores
    console.log(`\n⭐ Adding priority scores...`);
    const enrichedUrls = this.enrichWithPriority(categorizationResult.results);

    // Step 3: Sort by priority (optional)
    if (sortByPriority) {
      enrichedUrls.sort((a, b) => b.priority - a.priority);
      console.log(`✅ URLs sorted by priority (highest first)`);
    }

    // Calculate priority distribution
    const priorityDistribution = {};
    for (let i = 1; i <= 10; i++) {
      priorityDistribution[i] = enrichedUrls.filter(u => u.priority === i).length;
    }

    console.log(`\n📊 Priority distribution:`);
    for (let i = 10; i >= 1; i--) {
      if (priorityDistribution[i] > 0) {
        console.log(`   Priority ${i}: ${priorityDistribution[i]} URLs`);
      }
    }

    return {
      success: true,
      totalUrls: enrichedUrls.length,
      urls: enrichedUrls,
      summary: {
        ...categorizationResult.summary,
        priorityDistribution
      },
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new UrlCategorizationService();