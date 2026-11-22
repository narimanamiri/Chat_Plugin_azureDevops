# Team Chat

Team chat that lives inside Azure DevOps, with no server of its own.

Messages are stored in Azure DevOps' built-in extension data store, so there
is nothing to deploy, nothing to connect to, and it works on an air-gapped
Azure DevOps Server.

## Messages are not encrypted

Earlier versions encrypted messages end to end. That is gone as of 0.7.0.

The cryptography worked; its key management did not. Keys had to live in the
browser, so every browser change, profile reset or reinstall produced a new
identity, and messages encrypted to the old one became unreadable. Recovery
depended on another member still holding a usable key and being online. In
practice that meant repeated lockouts.

So, plainly: **anyone who can read your project collection's extension data
can read every message.** That includes your Azure DevOps administrator, your
database administrator, anyone with a collection backup, and any colleague
willing to call the REST API. Treat it like a comment on a work item, not
like a private channel.

## What it does

- **Direct messages and channels** across the whole project collection
- **File sharing**, chunked so it fits the document store, with an integrity
  check on download
- **Rich references** - `#1234` a work item, `!1234` a pull request, a git sha
  a commit, `@Name` a person - resolved to live titles and clickable
- **Unread badge** in the hub, a dashboard widget, and optional desktop
  notifications
- **Discuss in Team Chat** on work items, backlog rows and commits
- **Replies**, inline image previews, paste or drag a screenshot straight in
- **Unread divider**, jump-to-latest, and scroll back through history a page
  at a time
- **Delete** a conversation and everything in it, from the server

## Requirements

- Azure DevOps Services, or Azure DevOps Server 2020 or later
- HTTP or HTTPS - there is no longer any WebCrypto dependency
- A modern Chromium, Firefox or Safari browser

---

# User manual (English)

## Getting started

Open your project and choose **Chat → Messages** in the left navigation.
There is no setup: your name is registered automatically the first time you
open it.

## Start a direct message

1. Click the compose icon (✎) at the top of the conversation list.
2. Type a colleague's name - at least two characters.
3. Click the person to open the conversation.

You can message anybody in the project collection, not only people in your
current project.

## Create a channel

Click the **#** icon, give the channel a name, tick the people to add, then
choose **Create**.

## Send a message

Type in the box at the bottom and press **Enter**. Use **Shift+Enter** for a
new line without sending.

## Link to work items, pull requests and commits

Type these anywhere in a message and they become clickable chips showing the
live title:

| You type | It links to |
| --- | --- |
| `#1234` | Work item 1234 |
| `!1234` | Pull request 1234 |
| `9f2a1c4` | The commit with that sha (7 characters or more) |
| `@Jane Doe` | That person |

## Attach a file

Three ways: click the paperclip, **paste** an image straight from the
clipboard, or **drag and drop** a file onto the message box. Maximum 16 MB
per file.

Images appear inline in the conversation; click one to download it. Other
files show as a download row. Every file is checked against a hash before it
opens, so a truncated upload is caught rather than handed to you broken.

## Reply to a message

Hover a message and click the reply arrow. The message you are answering is
quoted above the box while you type, and stays attached to your reply so the
thread is readable later.

## Reading history

- The blue **Unread messages** line marks where you left off.
- Scroll up to load earlier messages a page at a time.
- The round button at the bottom right jumps back to the latest message. New
  messages only scroll the view when you are already at the bottom, so
  reading history is never interrupted.

## Notifications

- The bell in the conversation header shows your unread count.
- Add the **Team Chat unread** widget to a team dashboard to see the count
  without opening the chat.
- Desktop notifications appear if you allow them when the browser asks.
  These need HTTPS - the browser blocks them on plain HTTP.

## Discuss a work item or a commit

Open a work item, a backlog row or a commit, and choose **Discuss in Team
Chat** from its menu. That opens a channel dedicated to that item, and
everyone who uses the same menu lands in the same channel.

## Delete a message or a conversation

- **One message:** hover over your own message and click the bin icon.
- **A whole conversation:** the bin icon in the conversation header. This
  removes the conversation, every message and every attachment **for all
  members**, and cannot be undone.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| The people list is empty | Uninstall and reinstall the extension in the collection so the required permissions are granted. An in-place Update does not grant new ones |
| Somebody shows as an id instead of a name | It repairs itself once the directory loads, usually a few seconds after opening |
| Reporting a problem | Press F12, run `secureChatDiagnose()` in the console, and send the output. It contains no message text |

---

<div dir="rtl" align="right">

# راهنمای کاربر (فارسی)

## شروع کار

پروژه خود را باز کنید و از منوی سمت چپ، گزینه **Chat ← Messages** را انتخاب
کنید. هیچ تنظیم اولیه‌ای لازم نیست؛ نام شما در نخستین ورود به‌صورت خودکار ثبت
می‌شود.

## شروع گفتگوی خصوصی

1. روی آیکون نوشتن (✎) در بالای فهرست گفتگوها کلیک کنید.
2. نام همکار خود را تایپ کنید (حداقل دو حرف).
3. روی نام او کلیک کنید تا گفتگو باز شود.

شما می‌توانید با همه اعضای collection گفتگو کنید، نه فقط اعضای پروژه فعلی.

## ساخت کانال

روی آیکون **#** کلیک کنید، یک نام برای کانال بنویسید، اعضای موردنظر را انتخاب
کنید و دکمه **Create** را بزنید.

## ارسال پیام

متن را در کادر پایین صفحه بنویسید و کلید **Enter** را بزنید. برای رفتن به خط
بعد بدون ارسال پیام، از **Shift+Enter** استفاده کنید.

## ارجاع به work item و pull request و commit

اگر این نشانه‌ها را در متن پیام بنویسید، به‌صورت خودکار به لینک قابل کلیک با
عنوان واقعی تبدیل می‌شوند:

| آنچه می‌نویسید | به چه چیزی لینک می‌شود |
| --- | --- |
| `#1234` | work item شماره ۱۲۳۴ |
| `!1234` | pull request شماره ۱۲۳۴ |
| `9f2a1c4` | commit با آن sha (هفت کاراکتر یا بیشتر) |
| `@Jane Doe` | اشاره به آن شخص |

## پیوست کردن فایل

سه راه دارد: کلیک روی آیکون گیره کاغذ، **چسباندن (Paste)** تصویر از کلیپ‌بورد،
یا **کشیدن و رها کردن** فایل روی کادر پیام. حداکثر حجم هر فایل ۱۶ مگابایت است.

تصاویر به‌صورت مستقیم داخل گفتگو نمایش داده می‌شوند؛ با کلیک روی تصویر آن را
دانلود می‌کنید. سایر فایل‌ها به شکل یک ردیف دانلود نشان داده می‌شوند. سلامت هر
فایل پیش از باز شدن با hash بررسی می‌شود تا آپلود ناقص تشخیص داده شود.

## پاسخ به یک پیام

نشانگر ماوس را روی پیام ببرید و روی آیکون پاسخ کلیک کنید. پیامی که به آن پاسخ
می‌دهید بالای کادر نوشتن نقل‌قول می‌شود و به پاسخ شما پیوست می‌ماند تا بعداً
دنبال کردن گفتگو آسان باشد.

## خواندن تاریخچه

- خط آبی **Unread messages** جایی را که مطالعه را رها کرده‌اید مشخص می‌کند.
- با اسکرول به بالا، پیام‌های قدیمی‌تر صفحه‌به‌صفحه بارگذاری می‌شوند.
- دکمه گرد پایین سمت چپ شما را به آخرین پیام برمی‌گرداند. پیام‌های جدید فقط
  وقتی صفحه را حرکت می‌دهند که در انتهای گفتگو باشید، بنابراین خواندن تاریخچه
  هرگز قطع نمی‌شود.

## اعلان‌ها

- آیکون زنگ در بالای گفتگو، تعداد پیام‌های خوانده‌نشده را نشان می‌دهد.
- ویجت **Team Chat unread** را می‌توانید به داشبورد تیم اضافه کنید تا تعداد
  پیام‌های خوانده‌نشده را بدون باز کردن چت ببینید.
- اگر هنگام درخواست مرورگر اجازه دهید، اعلان دسکتاپ هم دریافت می‌کنید. این
  قابلیت به HTTPS نیاز دارد و روی HTTP ساده توسط مرورگر مسدود می‌شود.

## گفتگو درباره یک work item یا commit

یک work item، یک ردیف backlog یا یک commit را باز کنید و از منوی آن گزینه
**Discuss in Team Chat** را انتخاب کنید. با این کار کانالی مخصوص همان آیتم باز
می‌شود و هر کسی که از همین منو استفاده کند به همان کانال وارد می‌شود.

## حذف پیام یا گفتگو

- **یک پیام:** نشانگر ماوس را روی پیام خودتان ببرید و روی آیکون سطل زباله کلیک
  کنید.
- **کل گفتگو:** آیکون سطل زباله در بالای گفتگو. این کار گفتگو، همه پیام‌ها و
  همه پیوست‌ها را **برای تمام اعضا** حذف می‌کند و برگشت‌ناپذیر است.

## نکته مهم درباره محرمانگی

پیام‌ها رمزگذاری **نمی‌شوند**. مدیر Azure DevOps، مدیر پایگاه داده، هر کسی که
نسخه پشتیبان collection را داشته باشد و هر همکاری که بتواند REST API را صدا
بزند، می‌تواند تمام پیام‌ها را بخواند. با این چت مانند یک کامنت روی work item
رفتار کنید، نه مانند یک کانال خصوصی.

## رفع اشکال

| مشکل | راه حل |
| --- | --- |
| فهرست افراد خالی است | افزونه را از collection حذف و دوباره نصب کنید تا دسترسی‌های لازم داده شود. به‌روزرسانی ساده، دسترسی جدید نمی‌دهد |
| به‌جای نام، شناسه کاربر نمایش داده می‌شود | پس از بارگذاری فهرست کاربران، معمولاً چند ثانیه بعد، خودبه‌خود درست می‌شود |
| گزارش مشکل | کلید F12 را بزنید، در کنسول دستور `secureChatDiagnose()` را اجرا کنید و خروجی را ارسال کنید. این خروجی هیچ متنی از پیام‌ها ندارد |

</div>

---

## About

Developed by **Nariman Amiri**.

توسعه‌یافته توسط **نریمان امیری**.
