/**
 * i18n.ts - interface strings in English and Persian.
 *
 * Why hand-rolled rather than a library: this runs inside an Azure DevOps
 * extension iframe where every kilobyte is loaded on every page view, and
 * the whole surface is a few dozen strings. A full i18n runtime would be
 * larger than the thing it translates.
 *
 * Persian is right-to-left, so choosing it also flips the document
 * direction. That is handled by `applyLanguage` rather than by each
 * component: layout mirroring belongs to CSS logical properties, not to
 * conditionals scattered through the tree.
 *
 * Numbers are rendered with the locale's own digits through `formatNumber`.
 * An unread badge reading "3" next to Persian text looks wrong in a way
 * that is hard to place until you see "۳" beside it.
 */

export type Lang = "en" | "fa";

export const LANGUAGES: { code: Lang; label: string; dir: "ltr" | "rtl" }[] = [
  { code: "en", label: "English", dir: "ltr" },
  { code: "fa", label: "فارسی", dir: "rtl" },
];

export const dirOf = (lang: Lang): "ltr" | "rtl" => (lang === "fa" ? "rtl" : "ltr");

/** Key set. Exhaustive by construction: every language must supply all of it. */
export interface Strings {
  appTitle: string;
  newChannel: string;
  newMessage: string;

  search: string;
  searchPlaceholder: string;
  searchNoResults: string;
  searchTruncated: string;
  searchHint: string;
  searchResults: string;
  clearSearch: string;

  noConversations: string;
  noMessagesYet: string;
  selectChat: string;
  directMessage: string;
  members: string;
  you: string;

  unreadMessages: string;
  loadEarlier: string;
  loading: string;
  jumpToLatest: string;

  messageDeleted: string;
  edited: string;
  sending: string;
  failedToSend: string;
  attachment: string;
  unavailable: string;

  reply: string;
  edit: string;
  del: string;
  react: string;
  cancel: string;
  save: string;
  copy: string;
  copied: string;

  composerPlaceholder: string;
  editingPlaceholder: string;
  attachFile: string;
  send: string;
  cancelReply: string;
  removeFiles: string;

  typing: string;
  typingTwo: string;
  typingMany: string;
  onlineNow: string;
  lastSeen: string;
  lastSeenUnknown: string;

  channelName: string;
  create: string;
  manageMembers: string;
  addPeople: string;
  removePerson: string;
  renameTitle: string;
  renameLabel: string;
  rename: string;

  deleteConvTitle: string;
  deleteConvBody: string;
  deleteConvShared: string;
  deleteConvNote: string;
  deleteForEveryone: string;
  deleting: string;
  deleteMsgTitle: string;
  deleteMsgBody: string;

  searchPeople: string;
  noPeople: string;
  keepTyping: string;
  directoryUnreadable: string;
  nobodyMatching: string;
  openingConversation: string;

  unreadOne: string;
  unreadMany: string;
  noUnread: string;

  couldNotStart: string;
  language: string;
  notEncrypted: string;
  about: string;
}

const EN: Strings = {
  appTitle: "Chat",
  newChannel: "New channel",
  newMessage: "New message",

  search: "Search messages",
  searchPlaceholder: "Search messages",
  searchNoResults: "No messages match that.",
  searchTruncated: "Showing the first matches only. Narrow the search for more.",
  searchHint: "Type at least two characters.",
  searchResults: "{n} result(s)",
  clearSearch: "Clear search",

  noConversations: "No conversations yet.",
  noMessagesYet: "No messages here yet. Say hello.",
  selectChat: "Select a chat to start messaging",
  directMessage: "direct message",
  members: "{n} members",
  you: "You: ",

  unreadMessages: "Unread messages",
  loadEarlier: "Load earlier messages",
  loading: "Loading...",
  jumpToLatest: "Jump to the latest message",

  messageDeleted: "Message deleted",
  edited: "edited",
  sending: "sending",
  failedToSend: "Not sent",
  attachment: "Attachment",
  unavailable: "no longer available",

  reply: "Reply",
  edit: "Edit",
  del: "Delete",
  react: "React",
  cancel: "Cancel",
  save: "Save",
  copy: "Copy text",
  copied: "Copied",

  composerPlaceholder: "Message",
  editingPlaceholder: "Edit your message",
  attachFile: "Attach a file",
  send: "Send",
  cancelReply: "Cancel reply",
  removeFiles: "Remove attachments",

  typing: "{name} is typing",
  typingTwo: "{name} and {other} are typing",
  typingMany: "{n} people are typing",
  onlineNow: "online",
  lastSeen: "last seen {when}",
  lastSeenUnknown: "",

  channelName: "Channel name",
  create: "Create",
  manageMembers: "Members",
  addPeople: "Add people",
  removePerson: "Remove",
  renameTitle: "Rename conversation",
  renameLabel: "Title",
  rename: "Rename",

  deleteConvTitle: "Delete this conversation?",
  deleteConvBody:
    "{title} and everything in it will be removed from the server: every message, every attachment, and the conversation record itself.",
  deleteConvShared:
    "This is not just for you. The documents are shared by the whole conversation, so all {n} member(s) lose it. It cannot be undone.",
  deleteConvNote:
    "Azure DevOps backups may still hold copies until they age out, and anything others already read or downloaded is theirs.",
  deleteForEveryone: "Delete for everyone",
  deleting: "Deleting...",
  deleteMsgTitle: "Delete this message?",
  deleteMsgBody:
    "The content is removed from the server for everyone in this conversation. It cannot be undone.",

  searchPeople: "Search people",
  noPeople: "No other people were found in this collection.",
  keepTyping: "Keep typing to search the whole directory.",
  directoryUnreadable: "The directory could not be read.",
  nobodyMatching: 'Nobody matching "{query}".',
  openingConversation: "Opening conversation...",

  unreadOne: "1 unread message",
  unreadMany: "{n} unread messages",
  noUnread: "No unread messages",

  couldNotStart: "Team Chat could not start",
  language: "Language",
  notEncrypted: "Messages are not encrypted",
  about: "About",
};

const FA: Strings = {
  appTitle: "گفتگو",
  newChannel: "کانال جدید",
  newMessage: "پیام جدید",

  search: "جستجوی پیام‌ها",
  searchPlaceholder: "جستجوی پیام‌ها",
  searchNoResults:
    "پیامی مطابق این جستجو پیدا نشد.",
  searchTruncated:
    "فقط نتایج اول نشان داده شده است. جستجو را دقیق‌تر کنید.",
  searchHint:
    "دست‌کم دو حرف بنویسید.",
  searchResults: "{n} نتیجه",
  clearSearch: "پاک کردن جستجو",

  noConversations: "هنوز گفتگویی ندارید.",
  noMessagesYet:
    "هنوز پیامی نیست. سلام کنید.",
  selectChat:
    "برای شروع، یک گفتگو را انتخاب کنید",
  directMessage: "گفتگوی خصوصی",
  members: "{n} عضو",
  you: "شما: ",

  unreadMessages: "پیام‌های خوانده‌نشده",
  loadEarlier: "پیام‌های قدیمی‌تر",
  loading: "در حال بارگذاری...",
  jumpToLatest: "رفتن به آخرین پیام",

  messageDeleted: "پیام حذف شد",
  edited: "ویرایش‌شده",
  sending: "در حال ارسال",
  failedToSend: "ارسال نشد",
  attachment: "پیوست",
  unavailable: "در دسترس نیست",

  reply: "پاسخ",
  edit: "ویرایش",
  del: "حذف",
  react: "واکنش",
  cancel: "انصراف",
  save: "ذخیره",
  copy: "کپی متن",
  copied: "کپی شد",

  composerPlaceholder: "پیام",
  editingPlaceholder: "پیام خود را ویرایش کنید",
  attachFile: "پیوست کردن فایل",
  send: "ارسال",
  cancelReply: "لغو پاسخ",
  removeFiles: "حذف پیوست‌ها",

  typing: "{name} در حال نوشتن است",
  typingTwo: "{name} و {other} در حال نوشتن هستند",
  typingMany: "{n} نفر در حال نوشتن هستند",
  onlineNow: "آنلاین",
  lastSeen: "آخرین بازدید {when}",
  lastSeenUnknown: "",

  channelName: "نام کانال",
  create: "ساختن",
  manageMembers: "اعضا",
  addPeople: "افزودن افراد",
  removePerson: "حذف",
  renameTitle: "تغییر نام گفتگو",
  renameLabel: "عنوان",
  rename: "تغییر نام",

  deleteConvTitle: "این گفتگو حذف شود؟",
  deleteConvBody:
    "{title} و همه محتوای آن از سرور حذف می‌شود: همه پیام‌ها، همه پیوست‌ها و خود رکورد گفتگو.",
  deleteConvShared:
    "این حذف فقط برای شما نیست. اسناد بین همه اعضا مشترک است، پس هر {n} عضو آن را از دست می‌دهند. این کار برگشت‌ناپذیر است.",
  deleteConvNote:
    "نسخه‌های پشتیبان Azure DevOps تا مدتی ممکن است رونوشت داشته باشند، و هر چه دیگران پیش‌تر خوانده یا دانلود کرده‌اند نزد خودشان می‌ماند.",
  deleteForEveryone: "حذف برای همه",
  deleting: "در حال حذف...",
  deleteMsgTitle: "این پیام حذف شود؟",
  deleteMsgBody:
    "محتوای پیام برای همه اعضای این گفتگو از سرور حذف می‌شود و بازگشتی ندارد.",

  searchPeople: "جستجوی افراد",
  noPeople:
    "شخص دیگری در این collection پیدا نشد.",
  keepTyping:
    "برای جستجوی کل دایرکتوری به تایپ ادامه دهید.",
  directoryUnreadable:
    "دایرکتوری کاربران خوانده نشد.",
  nobodyMatching: 'هیچ کس مطابق "{query}" نیست.',
  openingConversation: "در حال باز کردن گفتگو...",

  unreadOne: "۱ پیام خوانده‌نشده",
  unreadMany: "{n} پیام خوانده‌نشده",
  noUnread: "پیام خوانده‌نشده‌ای ندارید",

  couldNotStart: "گفتگوی تیمی اجرا نشد",
  language: "زبان",
  notEncrypted: "پیام‌ها رمزگذاری نمی‌شوند",
  about: "درباره",
};

export const STRINGS: Record<Lang, Strings> = { en: EN, fa: FA };

export type TranslateFn = (
  key: keyof Strings,
  params?: Record<string, string | number>
) => string;

/** Build a translator for one language. Unknown placeholders are left alone. */
export function translator(lang: Lang): TranslateFn {
  const table = STRINGS[lang] ?? EN;
  return (key, params) => {
    const template = table[key] ?? EN[key] ?? String(key);
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in params ? formatNumber(params[name], lang) : whole
    );
  };
}

/**
 * Render a value in the language's own digits.
 *
 * Persian text with Western digits reads as half-translated, and Azure
 * DevOps itself localises numerals, so matching it is the consistent
 * choice.
 */
export function formatNumber(value: string | number, lang: Lang): string {
  if (typeof value !== "number") return value;
  return lang === "fa" ? value.toLocaleString("fa-IR", { useGrouping: false }) : String(value);
}

/** BCP 47 tag for Intl, so dates and times follow the chosen language. */
export const localeOf = (lang: Lang): string => (lang === "fa" ? "fa-IR" : "en-GB");

/**
 * Apply a language to the document: direction, lang attribute and a hook
 * for CSS. Called once on load and again whenever the user switches.
 */
export function applyLanguage(lang: Lang): void {
  const root = document.documentElement;
  root.setAttribute("lang", lang);
  root.setAttribute("dir", dirOf(lang));
}

/**
 * The language to start in: the user's saved choice if there is one, else a
 * guess from the host's own locale, else English.
 */
export function guessLanguage(saved?: string): Lang {
  if (saved === "en" || saved === "fa") return saved;
  const candidates = [
    document.documentElement.getAttribute("lang") ?? "",
    ...(navigator.languages ?? [navigator.language ?? ""]),
  ];
  return candidates.some((c) => /^fa\b|-IR$/i.test(c)) ? "fa" : "en";
}
