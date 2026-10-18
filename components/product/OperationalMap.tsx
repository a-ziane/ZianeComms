'use client';
import {useState} from 'react';
import type {Caller,Responder} from '@/types';
import type {CaseContext} from '@/lib/product/workspace';
import {AREA_POINTS,mapPosition,locationLabel,type CaseLocation} from '@/lib/product/geography';
import {Icon} from './ui';
export default function OperationalMap({callers,responders,context,selectedId,selectedResponder,onSelect,onResponder,incident=false,compact=false}:{callers:Caller[];responders:Responder[];context:Record<string,CaseContext>;selectedId?:string;selectedResponder?:string;onSelect?:(id:string)=>void;onResponder?:(id:string)=>void;incident?:boolean;compact?:boolean}){
 const [showResponders,setShowResponders]=useState(true);
 const entries=callers.map(c=>({c,geo:context[c.id]?.location}));
 const points=entries.flatMap(({geo})=>geo&&mapPosition(geo)?[mapPosition(geo)!]:[]);
 const center=points.length?{lat:points.reduce((a,p)=>a+p.lat,0)/points.length,lng:points.reduce((a,p)=>a+p.lng,0)/points.length}:{lat:34.05,lng:-118.25};
 const span=Math.max(.16,...points.flatMap(p=>[Math.abs(p.lat-center.lat)*3,Math.abs(p.lng-center.lng)*3]));
 const project=(p:{lat:number;lng:number})=>({x:400+(p.lng-center.lng)/span*680,y:245-(p.lat-center.lat)/span*420});
 const unknown=entries.filter(e=>!e.geo||!mapPosition(e.geo)).length;
 const responderPoint=(r:Responder):CaseLocation|null=>r.deploymentId==='algeria'?null:r.coverageAreas[0]?{...AREA_POINTS[r.coverageAreas[0]],kind:'synthetic',label:'Synthetic responder location'}:null;
 return <section className={`zc-map ${compact?'zc-map-compact':''}`} aria-label="Operational area map">
  <div className="zc-map-heading"><span><Icon name="pin" size={15}/> Operational picture</span><span className="zc-tag">SYNTHETIC AREAS</span></div>
  <svg viewBox="0 0 800 490" role="img" aria-label="Schematic geographic view. Area markers are approximate; no live emergency zones or responder tracking.">
   <defs><pattern id={compact?'map-grid-small':'map-grid'} width="45" height="45" patternUnits="userSpaceOnUse"><path d="M45 0H0V45" fill="none" stroke="#283940" strokeWidth=".7"/></pattern></defs>
   <rect width="800" height="490" fill="#132127"/><rect width="800" height="490" fill={`url(#${compact?'map-grid-small':'map-grid'})`}/>
   <path d="M0 390 100 360 143 403 198 420 250 490H0Z" fill="#17373c"/><path d="m625 0-68 99 43 77-33 88 48 95-21 131" stroke="#295059" strokeWidth="12" fill="none"/>
   <g stroke="#35474c" strokeWidth="2" fill="none"><path d="M0 195 250 180 415 230 800 200M135 0l70 163-20 140 50 187M0 325l220-50 300 27 280-20M400 0l-15 150 15 165 45 175M0 98l800 32M700 0 670 490"/></g>
   <g fill="#60777c" fontSize="11" letterSpacing="3"><text x="87" y="70">NORTH DISTRICT</text><text x="320" y="260">CENTRAL</text><text x="62" y="260">WEST SIDE</text><text x="625" y="160">EASTSIDE</text><text x="543" y="438">SOUTH / RIVERSIDE</text></g>
   {incident&&<g><ellipse cx="510" cy="190" rx="115" ry="76" fill="#b45243" fillOpacity=".08" stroke="#d28462" strokeDasharray="5 6"/><text x="449" y="138" fill="#dca383" fontSize="9" letterSpacing="2">DEMO INCIDENT AREA</text></g>}
   {entries.map(({c,geo},index)=>{const p=geo&&mapPosition(geo);if(!p)return null;const xy=project(p),selected=c.id===selectedId,color=['#ff7069','#f6aa62','#e6c366','#70c5a4'][c.priority];return <g key={c.id} transform={`translate(${xy.x+index*2} ${xy.y-index*2})`} role="button" tabIndex={0} aria-label={`Map case ${c.name}. ${locationLabel(geo)}`} onClick={()=>onSelect?.(c.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect?.(c.id);}}} className="zc-map-marker"><title>{c.name} · {locationLabel(geo)}</title>{geo.kind==='area'&&<circle r={selected?39:27} fill={color} fillOpacity=".07" stroke={color} strokeOpacity=".35" strokeDasharray="3 4"/>}{selected&&<circle r="20" fill="none" stroke={color} strokeOpacity=".4"/>}<circle r="12" fill="#14232a" stroke={color} strokeWidth="2"/><text y="4" textAnchor="middle" fill={color} fontWeight="700" fontSize="10">{c.priority}</text><text x="19" y="-13" fill="#eef3ed" fontSize="10" fontWeight="600">{c.name.split(' ')[0]}</text></g>;})}
   {showResponders&&responders.map((r,index)=>{const geo=responderPoint(r),p=geo&&mapPosition(geo);if(!p)return null;const xy=project(p),offset=22+(index%3)*14;return <g key={r.id} transform={`translate(${xy.x+offset} ${xy.y+30+(index%2)*18})`} role="button" tabIndex={0} aria-label={`Map responder ${r.name}, ${r.status}, synthetic location`} onClick={()=>onResponder?.(r.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onResponder?.(r.id);}}} className="zc-map-marker"><title>{r.name} · {r.status} · synthetic position; coverage feeds matching</title><rect x="-6" y="-6" width="12" height="12" rx="3" fill={r.id===selectedResponder?'#d9f4e8':'#60bcae'} fillOpacity={r.status==='offline'?.25:1}/><path d="M-3 0h6M0-3v6" stroke="#14232a" strokeWidth="1.2"/></g>;})}
   <text x="28" y="460" fill="#698087" fontSize="10">AREA PROJECTION · NOT STREET-ACCURATE · NO ROUTE GUIDANCE</text>
   <g transform="translate(756 54)" fill="#acc0be"><path d="m0-20-6 18 6-3 6 3Z"/><text y="15" textAnchor="middle" fontSize="10">N</text></g>
  </svg>
  <div className="zc-map-legend"><span><i className="zc-legend-dot"/> Request / approximate area</span><button aria-pressed={showResponders} onClick={()=>setShowResponders(!showResponders)}><i className="zc-legend-square"/> Responders</button><span>{unknown?`${unknown} location${unknown>1?'s':''} unmapped`:'Area-level coverage'}</span></div>
  <p className="zc-map-caption">Schematic LA districts; positions and incident shapes are synthetic. Shared coordinates are projected with reported accuracy. Unmapped Algeria/unknown areas stay unpinned.</p>
 </section>;
}
