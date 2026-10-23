# Google Ads Preparation Kit — Zero-Budget / Not Activated

**Current state:** preparation only. Paid campaigns must remain paused until a budget, account billing, landing pages, and measurement have been approved.

## 1. Campaign architecture

Start with Search only when funded; avoid splitting a small budget across too many campaigns.

| Campaign | Ad group | Keyword themes to validate | Landing page |
|---|---|---|---|
| Search — Website Services | Website design | website design agency; web development services; business website development | Most relevant real service page or homepage |
| Search — Product Design | UI/UX and product design | digital product design agency; UI UX design services; web app design services | Most relevant real service page or homepage |
| Search — Engineering | Custom development | custom software development; software engineering services; technology architecture consulting | Most relevant real service page or homepage |
| Search — Optimization | Performance | website performance optimization; website optimization services | Only if this service is clearly described |

Keywords are hypotheses, not researched volume or cost claims. Validate each in Keyword Planner for selected countries and languages. Remove terms that do not match actual service capabilities.

## 2. Responsive Search Ad copy bank

**Headline candidates (check current character limits in the account):**
- Orynex Studio | Digital Solutions
- Website Design & Development
- Digital Product Design
- Custom Engineering Services
- Technology Architecture
- Performance-Focused Development
- Design. Engineering. Performance.
- Your Idea Deserves a Better Digital Experience
- Explore Orynex Studio
- Let's Discuss Your Project

**Description candidates:**
- Shape your next digital experience with thoughtful design, engineering, and technology.
- Explore Orynex Studio's digital product design, custom development, and technical services.
- Have a project idea? Share your goals and explore a practical next step with Orynex Studio.

Use only claims supported by the actual website and team capability. Review ad policies, character limits, and destination requirements before upload.

## 3. Keyword research worksheet

For each keyword, record:
- Keyword:
- Search intent:
- Country/language:
- Keyword Planner average searches (if available):
- Estimated top-of-page bid range (if available):
- Relevance to service (1–5):
- Landing page:
- Decision: Test / Hold / Exclude
- Negative keyword notes:

Initial negative keyword ideas to review against actual intent: jobs, careers, salary, internship, course, tutorial, free template, DIY, cracked, pirated. Do not apply blindly if these terms might be relevant to an actual offer.

## 4. Geographic and language strategy

“Worldwide” should be treated as a research scope, not an instruction to target every country immediately. Review service capacity, language, currency, time-zone coverage, and likely lead quality. Start with a manageable set of countries after research, then expand based on evidence. Review Google's location options and choose presence/interest settings deliberately.

## 5. Landing-page readiness checklist

- [ ] Each advertised service is accurately described.
- [ ] One clear CTA appears above the fold on mobile.
- [ ] Contact form works and provides clear success/error feedback.
- [ ] Project overview asks for enough detail without over-collecting data.
- [ ] Privacy notice is accessible and accurate.
- [ ] Page is fast, responsive, accessible, and free of broken links.
- [ ] No placeholder copy, unsupported claims, or misleading portfolio items.
- [ ] Destination and canonical URLs use https://orynexstudio.vercel.app/ consistently unless an approved custom domain is adopted.
- [ ] Thank-you state or reliable form-success event exists before conversion tracking is configured.

## 6. Conversion measurement plan

**Primary conversion:** successful, valid lead submission after server/form success is confirmed.  
**Secondary diagnostics:** CTA clicks, contact-section views, outbound email clicks. Do not count diagnostic events as primary leads.

Implementation steps:
1. Inventory existing analytics and tags before adding anything.
2. Decide on GA4 and/or Google Ads conversion measurement.
3. Fire a lead event only after confirmed success; use event deduplication.
4. Avoid sending names, emails, project descriptions, or other personal data in analytics event parameters.
5. Implement consent controls and privacy disclosures as required for the markets served.
6. Test with debugging tools and a controlled test submission.
7. Verify that a single submission creates one conversion and failed submissions create none.
8. Record event name, trigger, source, destination, consent behavior, test date, and reviewer.

Do not paste measurement IDs, secrets, or credentials into this document or Git history.

## 7. Launch gate

Paid ads remain **NOT READY** until all are true:
- [ ] Budget approved by owner
- [ ] Billing method and account verified by owner
- [ ] Keyword research completed
- [ ] Countries and languages selected intentionally
- [ ] Landing pages reviewed
- [ ] Conversion tracking tested
- [ ] Privacy/consent review completed
- [ ] Ad copy and destination policy review completed
- [ ] Daily budget and stop conditions documented
- [ ] Owner explicitly approves activation

## 8. Weekly campaign review template

**Date range:**  
**Spend:**  
**Impressions / clicks / CTR:**  
**Average CPC:**  
**Primary conversions:**  
**Cost per qualified lead:**  
**Search terms reviewed:**  
**Negative keywords added:**  
**Best ad/keyword and evidence:**  
**Budget changes and approval:**  
**Decision:** Continue / Adjust / Pause

Do not launch or activate campaigns automatically from this checklist.
