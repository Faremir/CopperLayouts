const get_element = id => document.getElementById(id);
const escape_html = value => String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
})[ch]);
const normalize = value => String(value).toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '');
