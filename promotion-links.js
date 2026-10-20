'use strict';
const LANDING_URL = 'https://zencore-terminal.magicpeony2.chatgpt.site';
const SYSTEM_URL = 'https://zencore-errante.onrender.com';
function whatsappNumber(value) {
  let text = String(value || '').trim().replace(/[\s()+.-]/g, '');
  if (text.startsWith('00')) text = text.slice(2);
  if (/^0\d{8,10}$/.test(text)) text = '60' + text.slice(1);
  return /^[1-9]\d{7,14}$/.test(text) ? text : '';
}
function promotionLinks(contact) {
  const code = String(contact?.code || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(code) || !contact.active || (contact.userStatus && contact.userStatus !== 'active')) return null;
  const phone = whatsappNumber(contact.phone);
  const registrationUrl = `${SYSTEM_URL}/u/${encodeURIComponent(code)}`;
  const landingUrl = `${LANDING_URL}/?ib=${encodeURIComponent(code)}`;
  const message = intent => `Hi ${contact.displayName || 'Admin / IB'}, saya ${intent === 'register' ? 'nak daftar dan guna' : 'nak tahu lebih lanjut tentang'} sistem ZenCore. Kod IB: ${code.toUpperCase()}. Pautan pendaftaran: ${registrationUrl}`;
  return { code, displayName: contact.displayName, phone, landingUrl, registrationUrl,
    whatsappReady: !!phone,
    whatsappRegisterUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message('register'))}` : '',
    whatsappEnquiryUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message('enquiry'))}` : '' };
}
module.exports = { LANDING_URL, SYSTEM_URL, whatsappNumber, promotionLinks };
