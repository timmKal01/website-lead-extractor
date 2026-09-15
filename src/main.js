import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const { startUrls = [{ url: 'https://apify.com' }], maxDepth = 1, maxPagesPerDomain = 20 } = input;

if (startUrls.length === 0) {
    throw new Error('No startUrls provided.');
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}[\s.-]\d{3,4}[\s.-]\d{3,4}/g;

const SOCIAL_DOMAINS = {
    linkedin: /linkedin\.com/i,
    twitter: /(?:twitter\.com|x\.com)/i,
    facebook: /facebook\.com/i,
    instagram: /instagram\.com/i,
    github: /github\.com/i,
};

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp)(?:@|$)/i;

/** Must match the event name configured in this Actor's pay-per-event pricing on Apify. */
const CONTACT_INFO_FOUND_EVENT = 'contact-info-found';

const pagesPerDomain = new Map();

const crawler = new CheerioCrawler({
    maxRequestsPerCrawl: startUrls.length * maxPagesPerDomain,
    requestHandler: async ({ request, $, enqueueLinks }) => {
        const domain = new URL(request.url).hostname.replace(/^www\./, '');
        const count = pagesPerDomain.get(domain) ?? 0;
        if (count >= maxPagesPerDomain) return;
        pagesPerDomain.set(domain, count + 1);

        const bodyText = $('body').text();
        const emails = [...new Set((bodyText.match(EMAIL_RE) ?? []).filter((e) => !IMAGE_EXT_RE.test(e)))];
        const phones = [...new Set(bodyText.match(PHONE_RE) ?? [])].filter((p) => p.replace(/\D/g, '').length >= 7);

        const socialProfiles = {};
        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            if (!href) return;
            for (const [platform, re] of Object.entries(SOCIAL_DOMAINS)) {
                if (!socialProfiles[platform] && re.test(href)) {
                    socialProfiles[platform] = href;
                }
            }
        });

        if (emails.length > 0 || phones.length > 0 || Object.keys(socialProfiles).length > 0) {
            await Actor.pushData({
                url: request.url,
                domain,
                emails,
                phones,
                socialProfiles,
            });
            await Actor.charge({ eventName: CONTACT_INFO_FOUND_EVENT });
            log.info(`Found contact info on ${request.url}`, {
                emails: emails.length,
                phones: phones.length,
                socialProfiles: Object.keys(socialProfiles).length,
            });
        }

        const depth = request.userData.depth ?? 0;
        if (depth < maxDepth && count + 1 < maxPagesPerDomain) {
            await enqueueLinks({
                strategy: 'same-domain',
                transformRequestFunction: (req) => {
                    req.userData.depth = depth + 1;
                    return req;
                },
            });
        }
    },
    failedRequestHandler: async ({ request }, error) => {
        log.warning(`Request failed: ${request.url}`, { error: error?.message });
    },
});

await crawler.run(startUrls.map((u) => (typeof u === 'string' ? u : u.url)).map((url) => ({ url, userData: { depth: 0 } })));

await Actor.exit();
