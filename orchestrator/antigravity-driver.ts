import type { Subprocess } from "bun";
import type { BaseAgentDriver, DriverNotification, DriverNotificationListener, DriverSessionOptions, DriverTurnResult, DriverUsage } from "../shared/agent-driver.ts";

export interface AntigravityRuntimeProfile {
  command: string;
  args?: string[];
  handshake: { method: string; params?: Record<string, unknown> };
  methodMap: { start: string; reply: string; steer?: string; interrupt?: string; resume?: string };
  usagePaths?: { input?: string; output?: string; cached?: string };
  maxLineBytes?: number;
  requestTimeoutMs?: number;
}
export class UnsupportedDriverOperationError extends Error {}
type Proc = Subprocess<"pipe","pipe","pipe">;
const getPath=(o:any,p?:string)=>p?.split(".").reduce((v,k)=>v?.[k],o);
export class AntigravityDriver implements BaseAgentDriver {
  readonly kind="gemini" as const; private proc:Proc; private profile:AntigravityRuntimeProfile;
  private aliveState=true; private thread:string|null=null; private active:string|null=null; private id=1; private buf=""; private listeners:DriverNotificationListener[]=[]; private pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:any}>(); private turn:{resolve:(v:DriverTurnResult)=>void;reject:(e:Error)=>void;content:string[];timer:any;id:number}|null=null; private last=Date.now(); private lastN=Date.now();
  private constructor(p:Proc, profile:AntigravityRuntimeProfile){this.proc=p;this.profile=profile;this.read();p.exited.then(c=>{this.aliveState=false;this.active=null;for(const [id,r] of this.pending){clearTimeout(r.timer);r.reject(new Error(`antigravity exited (code ${c})`));this.pending.delete(id)}if(this.turn){clearTimeout(this.turn.timer);this.turn.reject(new Error(`antigravity exited (code ${c})`));this.turn=null}})}
  static async spawn(cwd:string, env:Record<string,string|undefined>=process.env, profile:AntigravityRuntimeProfile):Promise<AntigravityDriver>{if(!profile?.command||!profile.handshake?.method||!profile.methodMap?.start)throw new Error("Invalid Antigravity runtime profile");const p=Bun.spawn([profile.command,...(profile.args??[])],{cwd,env,stdin:"pipe",stdout:"pipe",stderr:"pipe"}) as Proc;const d=new AntigravityDriver(p,profile);await d.rpc(profile.handshake.method,profile.handshake.params??{});return d}
  get threadId(){return this.thread} get activeTurnId(){return this.active} get alive(){return this.aliveState} get pid(){return this.proc.pid} get process(){return this.proc} get lastActivity(){return this.last} get lastNotificationActivity(){return this.lastN}
  onNotification(cb:DriverNotificationListener){this.listeners.push(cb)} onExit(cb:()=>void){this.proc.exited.then(()=>{try{cb()}catch{}})}
  async startSession(o:DriverSessionOptions){return this.turnCall(this.profile.methodMap.start,o.prompt,o)}
  async reply(t:string,p:string){if(this.thread&&t!==this.thread)throw new Error("Antigravity thread mismatch");return this.turnCall(this.profile.methodMap.reply??this.profile.methodMap.start,p,{prompt:p})}
  async resumeThread(t:string){if(!this.profile.methodMap.resume)throw new UnsupportedDriverOperationError("resumeThread");await this.rpc(this.profile.methodMap.resume,{threadId:t});this.thread=t}
  async steer(t:string,text:string){if(!this.profile.methodMap.steer)throw new UnsupportedDriverOperationError("steer");if(!this.active)throw new Error("Cannot steer: no active turn");await this.rpc(this.profile.methodMap.steer,{threadId:t,text})}
  async interrupt(t:string){if(!this.profile.methodMap.interrupt)throw new UnsupportedDriverOperationError("interrupt");await this.rpc(this.profile.methodMap.interrupt,{threadId:t})}
  async kill(){if(this.aliveState){this.aliveState=false;try{this.proc.kill()}catch{}}try{await this.proc.exited}catch{}}
  private async turnCall(method:string,prompt:string,o:DriverSessionOptions):Promise<DriverTurnResult>{const params={prompt,...(o.model?{model:o.model}:{}),...(o.cwd?{cwd:o.cwd}:{})};const response:any=await this.rpc(method,params);if(response?.threadId)this.thread=response.threadId;if(response?.turnId)this.active=response.turnId;return {threadId:this.thread??"",content:response?.content??response?.text??"",usage:this.usage(response)}}
  private rpc(method:string,params:Record<string,unknown>):Promise<any>{if(!this.aliveState)return Promise.reject(new Error("antigravity is not alive"));const id=this.id++;const timeout=this.profile.requestTimeoutMs??30000;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Request ${method} timed out`))},timeout);this.pending.set(id,{resolve:(v)=>{clearTimeout(timer);resolve(v)},reject:(e)=>{clearTimeout(timer);reject(e)},timer});try{this.proc.stdin.write(JSON.stringify({jsonrpc:"2.0",id,method,params})+"\n");this.proc.stdin.flush()}catch(e){this.pending.delete(id);clearTimeout(timer);reject(e)}})}
  private usage(v:any):DriverUsage|undefined{const p=this.profile.usagePaths;const u:DriverUsage={input_tokens:getPath(v,p?.input),output_tokens:getPath(v,p?.output),cached_input_tokens:getPath(v,p?.cached)};return Object.values(u).some(x=>typeof x==="number")?u:undefined}
  private emit(n:DriverNotification){for(const cb of this.listeners)try{cb(n)}catch{}}
  private rejectActive(error:Error){const latest=[...this.pending.keys()].at(-1);if(latest!==undefined){const p=this.pending.get(latest);this.pending.delete(latest);p?.reject(error)}if(this.turn){clearTimeout(this.turn.timer);this.turn.reject(error);this.turn=null}}
  private async read(){const r=this.proc.stdout.getReader(),d=new TextDecoder();for(;;){const x=await r.read();if(x.done)break;this.buf+=d.decode(x.value);const ls=this.buf.split("\n");this.buf=ls.pop()??"";for(const l of ls)if(l.trim()){if(new TextEncoder().encode(l).byteLength>(this.profile.maxLineBytes??1024*1024)){this.rejectActive(new Error("Antigravity frame exceeds maximum size"));continue}this.line(l)}}}
  private line(l:string){this.last=this.lastN=Date.now();let m:any;try{m=JSON.parse(l)}catch{this.emit({method:"protocol/error",params:{error:"Malformed JSON"}});this.rejectActive(new Error("Malformed Antigravity JSONL frame"));return}if(m.id!==undefined){const p=this.pending.get(m.id);if(!p)return this.emit({method:"protocol/unknown-id",params:m});this.pending.delete(m.id);if(m.error)p.reject(new Error(String(m.error.message??"RPC error")));else p.resolve(m.result);return}this.emit({method:m.method??"notification",threadId:m.params?.threadId,turnId:m.params?.turnId,params:m.params??{}})}
}
