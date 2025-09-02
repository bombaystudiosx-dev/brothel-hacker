/**
 * Brothel Hacker — Platform Adapters (Multi‑Network API)
 *
 * Purpose: One normalized posting/insights layer for many networks.
 * Style: Real endpoints where official APIs exist. Stubs where partner-only or no API.
 * Safety: No scraping, no TOS bypass. Adult platforms only via official partner APIs or manual export.
 *
 * Usage in Express (server.js):
 *   import { adapters, postToPlatform, capabilities } from './adapters.js'
 *   app.get('/api/adapters', (_req,res)=> res.json({ ok:true, capabilities }))
 *   app.post('/api/adapters/:platform/post', async (req,res)=>{
 *     try { const data = await postToPlatform(req.params.platform, req.body); res.json({ ok:true, data }) }
 *     catch(e){ res.status(e.status||500).json({ ok:false, error:e.message }) }
 *   })
 */

import axios from 'axios'

// ----------------------------- helpers -----------------------------
const err = (m, status=400)=> { const e = new Error(m); e.status = status; throw e }
const reqd = (o,k)=> { if(!o?.[k]) err(`missing_${k}`); return o[k] }

// Minimal HTTP with sane timeouts
const http = axios.create({ timeout: 12000 })

// Normalize inputs: {text, mediaUrl?, linkUrl?, alt?, hashtags?:[], tokens:{...}, account:{...}}

// ----------------------------- INSTAGRAM (Graph API) -----------------------------
async function instagramPost(input){
  const access_token = reqd(input.tokens,'IG_TOKEN')
  const ig_user_id   = reqd(input.account,'ig_user_id')
  const caption = input.text || ''
  const mediaUrl = input.mediaUrl
  if(!mediaUrl) err('instagram_requires_mediaUrl')
  // 1) create container
  const media = await http.post(`https://graph.facebook.com/v19.0/${ig_user_id}/media`, { image_url: mediaUrl, caption }, { params:{ access_token }})
  // 2) publish
  const pub = await http.post(`https://graph.facebook.com/v19.0/${ig_user_id}/media_publish`, { creation_id: media.data.id }, { params:{ access_token }})
  return { id: pub.data.id }
}

// ----------------------------- FACEBOOK PAGE -----------------------------
async function facebookPost(input){
  const token = reqd(input.tokens,'FB_PAGE_TOKEN')
  const page_id = reqd(input.account,'page_id')
  if(input.mediaUrl){
    const r = await http.post(`https://graph.facebook.com/v19.0/${page_id}/photos`, null, { params:{ url: input.mediaUrl, caption: input.text||'', access_token: token }})
    return { id: r.data.id }
  } else {
    const r = await http.post(`https://graph.facebook.com/v19.0/${page_id}/feed`, null, { params:{ message: input.text||'', access_token: token }})
    return { id: r.data.id }
  }
}

// ----------------------------- TWITTER / X (v2) -----------------------------
async function twitterPost(input){
  const bearer = reqd(input.tokens,'X_BEARER') // must be user-context token
  const r = await http.post('https://api.twitter.com/2/tweets', { text: input.text?.slice(0,280) || '' }, { headers:{ Authorization:`Bearer ${bearer}` }})
  return { id: r.data?.data?.id }
}

// ----------------------------- TIKTOK Business -----------------------------
async function tiktokPost(input){
  const token = reqd(input.tokens,'TT_ACCESS_TOKEN')
  const advertiser_id = reqd(input.account,'advertiser_id')
  // TikTok Content Posting is scoped; assume media previously uploaded to a public URL
  const r = await http.post('https://business-api.tiktok.com/open_api/v1.3/file/video/ad/upload/', {
    advertiser_id, video_url: reqd(input,'mediaUrl')
  }, { headers:{ 'Access-Token': token }})
  return { upload_id: r.data?.data?.id || 'uploaded' }
}

// ----------------------------- LINKEDIN (UGC Post) -----------------------------
async function linkedinPost(input){
  const token = reqd(input.tokens,'LI_TOKEN')
  const urn = reqd(input.account,'author_urn') // e.g., 'urn:li:person:...'
  const payload = {
    author: urn, lifecycleState:'PUBLISHED', specificContent:{ 'com.linkedin.ugc.ShareContent':{
      shareCommentary:{ text: input.text||'' }, shareMediaCategory: input.mediaUrl? 'IMAGE':'NONE',
      media: input.mediaUrl? [{ status:'READY', originalUrl: input.mediaUrl, title:{ text: input.alt||'Photo' }}]: undefined
    }}, visibility:{ 'com.linkedin.ugc.MemberNetworkVisibility':'PUBLIC' }
  }
  const r = await http.post('https://api.linkedin.com/v2/ugcPosts', payload, { headers:{ Authorization:`Bearer ${token}` }})
  return { id: r.headers['x-restli-id'] || 'ok' }
}

// ----------------------------- SNAPCHAT (Marketing API placeholder) -----------------------------
async function snapchatPost(_input){ err('snapchat_posting_requires_marketing_api_and_creatives',501) }

// ----------------------------- PINTEREST -----------------------------
async function pinterestPost(input){
  const token = reqd(input.tokens,'PIN_TOKEN')
  const board_id = reqd(input.account,'board_id')
  const r = await http.post('https://api.pinterest.com/v5/pins', { link: input.linkUrl||undefined, title: input.text?.slice(0,97)||' ', alt_text: input.alt||undefined, board_id, media_source:{ source_type:'image_url', url: reqd(input,'mediaUrl') } }, { headers:{ Authorization:`Bearer ${token}` }})
  return { id: r.data?.id }
}

// ----------------------------- REDDIT -----------------------------
async function redditPost(input){
  const token = reqd(input.tokens,'REDDIT_TOKEN')
  const sr = reqd(input.account,'subreddit')
  const r = await http.post('https://oauth.reddit.com/api/submit', new URLSearchParams({ sr, kind: input.mediaUrl? 'image':'self', title: (input.text||'').slice(0,290), url: input.mediaUrl||'', text: input.mediaUrl? '' : input.text||'' }).toString(), { headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/x-www-form-urlencoded' }})
  return { status: r.status }
}

// ----------------------------- TUMBLR -----------------------------
async function tumblrPost(input){ err('tumblr_v2_posting_require_oauth1_flow',501) }

// ----------------------------- YOUTUBE (metadata stub) -----------------------------
async function youtubePost(_input){ err('use_resumable_upload_to_youtube_data_api_v3',501) }

// ----------------------------- WHATSAPP (Business Cloud) -----------------------------
async function whatsappSend(input){
  const token = reqd(input.tokens,'WAPP_TOKEN')
  const phone_id = reqd(input.account,'phone_number_id')
  const to = reqd(input,'to')
  const r = await http.post(`https://graph.facebook.com/v19.0/${phone_id}/messages`, { messaging_product:'whatsapp', to, type:'text', text:{ body: input.text||'' } }, { headers:{ Authorization:`Bearer ${token}` }})
  return { id: r.data?.messages?.[0]?.id }
}

// ----------------------------- DISCORD (Webhook) -----------------------------
async function discordPost(input){
  const url = reqd(input.tokens,'DISCORD_WEBHOOK')
  const r = await http.post(url, { content: input.text||'', embeds: input.mediaUrl? [{ image:{ url: input.mediaUrl } }]: undefined })
  return { status: r.status }
}

// ----------------------------- TWITCH -----------------------------
async function twitchPost(_input){ err('twitch_posting_not_supported; consider chat bot or channel points integration',501) }

// ----------------------------- CLUBHOUSE -----------------------------
async function clubhousePost(_input){ err('no_public_api',501) }

// ----------------------------- VIMEO -----------------------------
async function vimeoPost(_input){ err('use_vimeo_uploads_api_oauth2',501) }

// ----------------------------- MEDIUM -----------------------------
async function mediumPost(input){
  const token = reqd(input.tokens,'MEDIUM_TOKEN')
  const userId = reqd(input.account,'user_id')
  const r = await http.post(`https://api.medium.com/v1/users/${userId}/posts`, { title: input.title||'Untitled', contentFormat:'markdown', content: input.text||'', publishStatus:'public' }, { headers:{ Authorization:`Bearer ${token}` }})
  return { id: r.data?.data?.id }
}

// ----------------------------- QUORA -----------------------------
async function quoraPost(_input){ err('no_public_content_api',501) }

// ----------------------------- ONLYFANS / PORNHUB -----------------------------
async function onlyfansPost(_input){ err('no_public_api_use_official_partner_or_manual_export',501) }
async function pornhubPost(_input){ err('partner_api_required',501) }

// ----------------------------- TELEGRAM -----------------------------
async function telegramPost(input){
  const token = reqd(input.tokens,'TELEGRAM_BOT_TOKEN')
  const chat_id = reqd(input.account,'chat_id')
  if(input.mediaUrl){
    const r = await http.post(`https://api.telegram.org/bot${token}/sendPhoto`, { chat_id, photo: input.mediaUrl, caption: input.text||'' })
    return { id: r.data?.result?.message_id }
  } else {
    const r = await http.post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id, text: input.text||'' })
    return { id: r.data?.result?.message_id }
  }
}

// ----------------------------- WECHAT (Official Accounts) -----------------------------
async function wechatPost(_input){ err('requires_wechat_official_account_access_token_and_message_send_api',501) }

// ----------------------------- LINE (Messaging API) -----------------------------
async function linePost(input){
  const token = reqd(input.tokens,'LINE_CHANNEL_TOKEN')
  const to = reqd(input,'to')
  const r = await http.post('https://api.line.me/v2/bot/message/push', { to, messages:[{ type:'text', text: input.text||'' }] }, { headers:{ Authorization:`Bearer ${token}` }})
  return { status: r.status }
}

// ----------------------------- VIBER (Bot) -----------------------------
async function viberPost(input){
  const token = reqd(input.tokens,'VIBER_TOKEN')
  const r = await http.post('https://chatapi.viber.com/pa/broadcast_message', { broadcast_list: input.recipients||[], type:'text', text: input.text||'' }, { headers:{ 'X-Viber-Auth-Token': token }})
  return { status: r.status }
}

export const adapters = {
  instagram: instagramPost,
  facebook: facebookPost,
  twitter: twitterPost,
  tiktok: tiktokPost,
  linkedin: linkedinPost,
  snapchat: snapchatPost,
  pinterest: pinterestPost,
  reddit: redditPost,
  tumblr: tumblrPost,
  youtube: youtubePost,
  whatsapp: whatsappSend,
  discord: discordPost,
  twitch: twitchPost,
  clubhouse: clubhousePost,
  vimeo: vimeoPost,
  medium: mediumPost,
  quora: quoraPost,
  onlyfans: onlyfansPost,
  pornhub: pornhubPost,
  telegram: telegramPost,
  wechat: wechatPost,
  line: linePost,
  viber: viberPost,
}

export const capabilities = Object.freeze({
  instagram:{ post:true, media:true, analytics:false, notes:'Graph API media_publish (image/video)' },
  facebook:{ post:true, media:true, analytics:true, notes:'Pages feed/photos' },
  twitter:{ post:true, media:false, analytics:false, notes:'Requires user-context OAuth2; 280 chars' },
  tiktok:{ post:true, media:true, analytics:false, notes:'Business Content Posting; advertiser scope' },
  linkedin:{ post:true, media:true, analytics:false, notes:'UGC posts; needs author URN' },
  snapchat:{ post:false, media:true, analytics:false, notes:'Ads only via Marketing API' },
  pinterest:{ post:true, media:true, analytics:false, notes:'v5 Pins API' },
  reddit:{ post:true, media:true, analytics:false, notes:'/api/submit OAuth' },
  tumblr:{ post:false, media:true, analytics:false, notes:'OAuth1; implement if needed' },
  youtube:{ post:false, media:true, analytics:true, notes:'Resumable uploads; Data API v3' },
  whatsapp:{ post:true, media:true, analytics:false, notes:'Business Cloud API' },
  discord:{ post:true, media:true, analytics:false, notes:'Webhooks or bot' },
  twitch:{ post:false, media:false, analytics:true, notes:'Use chat bot/Helix for markers' },
  clubhouse:{ post:false, media:false, analytics:false, notes:'No public API' },
  vimeo:{ post:false, media:true, analytics:true, notes:'Uploads via OAuth2' },
  medium:{ post:true, media:false, analytics:false, notes:'Markdown posts' },
  quora:{ post:false, media:false, analytics:false, notes:'No public content API' },
  onlyfans:{ post:false, media:true, analytics:false, notes:'Partner/official only' },
  pornhub:{ post:false, media:true, analytics:false, notes:'Partner API only' },
  telegram:{ post:true, media:true, analytics:false, notes:'Bot API' },
  wechat:{ post:false, media:true, analytics:false, notes:'Official Account API' },
  line:{ post:true, media:true, analytics:false, notes:'Messaging API' },
  viber:{ post:true, media:false, analytics:false, notes:'Public Accounts API' },
})

export async function postToPlatform(platform, input){
  const fn = adapters[platform]
  if(!fn) err('unsupported_platform',404)
  return await fn(input)
}
