import { Actor, log } from 'apify';
import { CheerioCrawler } from 'crawlee';

await Actor.init();

const input = (await Actor.getInput()) ?? {};
const { startUrls = [{ url: 'https://apify.com' }], maxDepth = 1, maxPagesPerDomain = 20 } = input;

if (startUrls.length === 0) {
    throw new Error('No startUrls provided.');
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Non-global so .test() has no lastIndex state across calls.
const VALID_EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}$/;
// Only formats that are unambiguously phone numbers: international with a
// leading +, or North American (xxx) xxx-xxxx / xxx-xxx-xxxx with one consistent
// separator (so "500-999 1000" from a company-size menu is rejected). Looser
// digit-group patterns picked up order IDs, dates, and version strings.
const PHONE_RE = /\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){2,5}|\(\d{3}\)\s?\d{3}[\s.-]\d{4}\b|\b\d{3}([\s.-])\d{3}\1\d{4}\b/g;

// Template/placeholder addresses that appear in forms and docs, not real contacts.
const PLACEHOLDER_EMAIL_RE = /^(?:name|your|you|email|user|someone|example|test|john\.?doe|jane\.?doe)@|@(?:example|domain|company|email|yourdomain|yourcompany|sentry|wixpress)\.(?:com|org|net|io)$/i;

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

        // mailto:/tel: links are the site telling us exactly what its contact
        // details are, so they're read first and trusted as-is.
        const linkEmails = [];
        const linkPhones = [];
        $('a[href]').each((_, el) => {
            const href = ($(el).attr('href') ?? '').trim();
            if (/^mailto:/i.test(href)) linkEmails.push(decodeURIComponent(href.slice(7).split('?')[0]));
            if (/^tel:/i.test(href)) linkPhones.push(decodeURIComponent(href.slice(4)));
        });

        // Visible text only: scripts/styles hold JSON and escaped markup, and
        // joining text nodes with spaces keeps "sales@x.com" from running into
        // the next element's text ("sales@x.comCareers").
        $('script, style, noscript, template, svg').remove();
        const bodyText = $('body')
            .find('*')
            .addBack()
            .contents()
            .filter((_, node) => node.type === 'text')
            .map((_, node) => $(node).text())
            .get()
            .join(' ');

        const emails = [
            ...new Set(
                [...linkEmails, ...(bodyText.match(EMAIL_RE) ?? [])]
                    .map((e) => e.trim().toLowerCase())
                    .filter((e) => VALID_EMAIL_RE.test(e) && !IMAGE_EXT_RE.test(e) && !PLACEHOLDER_EMAIL_RE.test(e))
            ),
        ];
        // Same number often appears twice (tel: link "18888519456" and visible
        // "888-851-9456"): dedupe on digits, keeping the human-formatted text
        // version, which is read first.
        const phonesByDigits = new Map();
        for (const raw of [...(bodyText.match(PHONE_RE) ?? []), ...linkPhones]) {
            const phone = raw.trim().replace(/^[^\d+(]+|[^\d)]+$/g, '').replace(/^([^(]*)\)$/, '$1');
            if (/^\+0/.test(phone)) continue;
            let digits = phone.replace(/\D/g, '');
            if (digits.length < 7 || digits.length > 15) continue;
            if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
            if (!phonesByDigits.has(digits)) phonesByDigits.set(digits, phone);
        }
        const phones = [...phonesByDigits.values()];

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
