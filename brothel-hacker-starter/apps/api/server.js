import 'dotenv/config'
import express from 'express'
import axios from 'axios'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import cron from 'node-cron'
import multer from 'multer'
import { z } from 'zod'
import { RateLimiterMemory } from 'rate-limiter-flexible'
import robotsParser from 'robots-parser'
import * as cheerio from 'cheerio'

import { adapters, postToPlatform, capabilities } from './adapters.js'

const app = express()
app.use(express.json({ limit: '10mb' }))
app.use(cors())
app.use(helmet())
app.use(morgan('tiny'))

const limiter = new RateLimiterMemory({ points: 100, duration: 60 })
app.use(async (req,res,next)=>{ try { await limiter.consume(req.ip); next() } catch { res.status(429).json({ok:false,error:'rate_limited'}) } })

const approvals = new Map()
const alerts = []
const schedules = []

const ok = (res, data) => res.json({ ok: true, ...data })
const bad = (res, error, code=400) => res.status(code).json({ ok:false, error })

app.get('/health', (_req,res)=> ok(res,{ ts: Date.now() }))

// Approvals
const ApprovalItem = z.object({ platform:z.string(), kind:z.enum(['post','story','ad','reel']), text:z.string().min(1), mediaUrls:z.array(z.string().url()).optional() })
app.post('/api/approval/submit', (req,res)=>{
  const data = z.object({ items: z.array(ApprovalItem), policy: z.string().default('generic') }).safeParse(req.body)
  if(!data.success) return bad(res, data.error.message)
  const id = 'appr_'+Math.random().toString(36).slice(2)
  const record = { id, status:'PENDING', policy:data.data.policy, items:data.data.items, decisions:[], createdAt: new Date().toISOString() }
  approvals.set(id, record)
  ok(res, { id, status: record.status })
})
app.get('/api/approval/:id', (req,res)=>{
  const r = approvals.get(req.params.id)
  if(!r) return bad(res,'not_found',404)
  ok(res,{ approval:r })
})
app.post('/api/approval/:id/decision', (req,res)=>{
  const r = approvals.get(req.params.id)
  if(!r) return bad(res,'not_found',404)
  const body = z.object({ index:z.number().int().nonnegative(), decision:z.enum(['APPROVED','REJECTED']), note:z.string().optional() }).safeParse(req.body)
  if(!body.success) return bad(res, body.error.message)
  r.decisions[body.data.index] = { decision: body.data.decision, note: body.data.note, ts: new Date().toISOString() }
  r.status = r.decisions.includes(undefined) ? 'PENDING' : 'DECIDED'
  ok(res,{ status:r.status, decisions:r.decisions })
})

// Monitoring
app.post('/api/monitor/ingest', (req,res)=>{
  const event = z.object({ platform:z.string(), level:z.enum(['info','warn','violation']), code:z.string(), message:z.string(), ref:z.string().optional() }).safeParse(req.body)
  if(!event.success) return bad(res, event.error.message)
  const e = { ...event.data, ts: new Date().toISOString() }
  alerts.unshift(e)
  ok(res,{ received:true })
})
app.get('/api/monitor/alerts', (_req,res)=> ok(res,{ alerts: alerts.slice(0,200) }))

// AI
app.post('/api/ai/caption', async (req,res)=>{
  const p = z.object({ prompt:z.string().min(4), tone:z.string().default('direct') }).safeParse(req.body)
  if(!p.success) return bad(res,p.error.message)
  try {
    const key = process.env.OPENAI_API_KEY
    if(!key) return ok(res,{ caption: p.data.prompt + '\n\n— Neon grind, golden results. ✨ (LOCAL)' })
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {role:'system', content:'You are a social media copywriter. Keep under 2200 chars, add a single CTA.'},
        {role:'user', content:`Tone: ${p.data.tone}. Prompt: ${p.data.prompt}`}
      ]
    }, { headers:{ Authorization:`Bearer ${key}` }})
    const caption = r.data.choices?.[0]?.message?.content?.trim() || 'Caption.'
    ok(res,{ caption })
  } catch(err){ bad(res, 'openai_failed:'+err.message, 500) }
})

// Automation
app.post('/api/automation/calendar', (req,res)=>{
  const body = z.object({ platforms:z.array(z.string()), days:z.number().int().min(1).max(30).default(14) }).safeParse(req.body)
  if(!body.success) return bad(res, body.error.message)
  const start = Date.now()
  const items = Array.from({length: body.data.days}).map((_,i)=>({ day:i+1, idea:`Hook ${i+1}: Proof > promises.`, checks:['no banned words','disclose #ad if needed','no targeted attributes'], }))
  ok(res,{ startISO:new Date(start).toISOString(), items })
})

// Posting queue
app.post('/api/post', (req,res)=>{
  const body = z.object({ platforms:z.array(z.string()), text:z.string(), whenISO:z.string().optional(), mediaUrls:z.array(z.string().url()).optional() }).safeParse(req.body)
  if(!body.success) return bad(res, body.error.message)
  const job = { id:'job_'+Math.random().toString(36).slice(2), ...body.data, status:'QUEUED' }
  schedules.push(job)
  ok(res,{ job })
})

// Bulk schedule
app.post('/api/schedule/bulk', (req,res)=>{
  const b = z.object({ items:z.array(z.object({ platforms:z.array(z.string()), text:z.string(), whenISO:z.string() })) }).safeParse(req.body)
  if(!b.success) return bad(res,b.error.message)
  const created = b.data.items.map(it=>{ const job={ id:'job_'+Math.random().toString(36).slice(2), ...it, status:'QUEUED' }; schedules.push(job); return job })
  ok(res,{ created })
})

// Cron publisher (demo: calls adapter immediately when due)
cron.schedule('* * * * *', async ()=>{
  const now = Date.now()
  for(const job of schedules){
    if(job.status!=='QUEUED') continue
    if(!job.whenISO || new Date(job.whenISO).getTime() <= now){
      job.status='POSTING'
      try {
        for(const platform of job.platforms){
          // Simplified: one media URL if present
          await postToPlatform(platform.toLowerCase(), { text: job.text, mediaUrl: job.mediaUrls?.[0], tokens: {}, account: {} })
        }
        job.status='POSTED'; job.postedAt=new Date().toISOString()
      } catch(e){
        job.status='FAILED'; job.error = e.message
      }
    }
  }
})

// Extraction (robots-aware)
async function robotsAllows(targetUrl){
  try{
    const u = new URL(targetUrl)
    const robotsUrl = `${u.origin}/robots.txt`
    const r = await axios.get(robotsUrl, { timeout: 5000 }).catch(()=>null)
    if(!r || r.status!==200) return true
    const p = robotsParser(robotsUrl, r.data)
    return p.isAllowed(targetUrl, 'BrothelHackerBot')
  }catch{ return false }
}
app.get('/api/extract', async (req,res)=>{
  const url = req.query.url
  if(!url) return bad(res,'url_required')
  try{
    const allowed = await robotsAllows(url)
    if(!allowed) return bad(res,'blocked_by_robots', 451)
    const resp = await axios.get(url, { timeout: 10000, headers:{ 'User-Agent':'BrothelHackerBot/1.0' }})
    const $ = cheerio.load(resp.data)
    const title = $('meta[property="og:title"]').attr('content') || $('title').text() || ''
    const desc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || ''
    const text = $('article').text() || $('main').text() || $('body').text()
    ok(res,{ title, desc, text: text.slice(0, 20000) })
  }catch(e){ bad(res,'extract_failed:'+e.message,500) }
})

// Article drafting
app.post('/api/articles/draft', async (req,res)=>{
  const b = z.object({ topic:z.string().min(3), sourceSummary:z.string().default(''), tone:z.string().default('direct'), words:z.number().int().min(200).max(3000).default(900) }).safeParse(req.body)
  if(!b.success) return bad(res,b.error.message)
  try{
    const key = process.env.OPENAI_API_KEY
    if(!key) return ok(res,{ article:`# ${b.data.topic}\n\n(Developer mode) Provide your OPENAI_API_KEY to generate full copy.` })
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model:'gpt-4o-mini',
      messages:[
        {role:'system', content:'You are a senior content strategist. Create original, non-plagiarized articles. Cite sources generically, avoid copying phrasing. Markdown output.'},
        {role:'user', content:`Topic: ${b.data.topic}\nTone: ${b.data.tone}\nTarget length: ${b.data.words} words\nSource summary (optional): ${b.data.sourceSummary}`}
      ]
    },{ headers:{ Authorization:`Bearer ${key}` }})
    const article = r.data.choices?.[0]?.message?.content || ''
    ok(res,{ article })
  }catch(e){ bad(res,'openai_failed:'+e.message,500) }
})

// Media upload (placeholder)
const upload = multer({ storage: multer.memoryStorage(), limits:{ fileSize: 25*1024*1024 } })
app.post('/api/media/upload', upload.single('file'), (req,res)=>{
  if(!req.file) return bad(res,'no_file')
  ok(res,{ url:`data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')[:64]}...` })
})

// Adapters & capabilities
app.get('/api/adapters', (_req,res)=> ok(res,{ capabilities }))
app.post('/api/adapters/:platform/post', async (req,res)=>{
  try{ const data = await postToPlatform(req.params.platform, req.body); ok(res,{ data }) }
  catch(e){ bad(res, e.message, e.status||500) }
})

const port = process.env.PORT || 8080
app.listen(port, ()=> console.log('Brothel Hacker API listening on', port))
