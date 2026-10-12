# Landing page + WhatsApp IB
Admin and IB dashboards include a promotion panel. Share its landing link; `?ib=<code>` selects that exact active referrer. No parameter uses Admin code `nazir`; unknown or disabled codes fail closed and never fall back to another IB.

Contact defaults to the linked IB's profile phone. Admin can maintain a dedicated public WhatsApp contact for each active referrer; IB can maintain only their own. Save an empty contact to disable WhatsApp. Contact numbers are explicitly public on the promotion page. No client email, user ID, password or account details are exposed by the public endpoint.

WhatsApp register/enquiry links contain a ready message and the existing registration referral URL. Opening a link does not send a message; the visitor presses Send in WhatsApp. Direct web registration remains available when WhatsApp is unset. Registration assignment and existing authentication restrictions remain enforced by the existing registration flow.

Public endpoint: GET /auth/promotion/:code. Credential-free CORS is limited to the public landing origin. Dedicated DB override: zencore_ib_referrers.whatsapp_phone; NULL defaults to profile, empty disables.
