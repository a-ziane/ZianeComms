import type {CoverageArea} from '@/types';
import type {DeploymentId} from '@/config/deployments';
export interface GeoPoint {lat:number;lng:number;accuracy?:number;kind:'shared'|'synthetic';label:string}
export interface AreaLocation {kind:'area'|'unknown';label:string;coverage?:CoverageArea}
export type CaseLocation=GeoPoint|AreaLocation;
export const AREA_POINTS:Record<CoverageArea,{lat:number;lng:number}>={central:{lat:34.05,lng:-118.25},eastside:{lat:34.05,lng:-118.19},north:{lat:34.105,lng:-118.25},west:{lat:34.055,lng:-118.32},riverside:{lat:34.005,lng:-118.22}};
export function demoLocation(area:CoverageArea='central',profile:DeploymentId='los-angeles'):CaseLocation{return profile==='algeria'?{kind:'area',label:'Algiers · caller-described area; exact position unknown'}:{kind:'area',coverage:area,label:`${area[0].toUpperCase()+area.slice(1)} · synthetic Los Angeles area`};}
export function sharedLocation(position:{coords:{latitude:number;longitude:number;accuracy:number}}):GeoPoint{
 const {latitude:lat,longitude:lng,accuracy}=position.coords;
 if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lng)||Math.abs(lng)>180||!Number.isFinite(accuracy)||accuracy<0)throw Error('Invalid shared location');
 return {lat,lng,accuracy,kind:'shared',label:`Device-shared location · accuracy about ${Math.round(accuracy)} m`};
}
// Called only by the explicit “Share my location” button. Never on mount or during line switches.
export function requestLocation(api:Pick<Geolocation,'getCurrentPosition'>):Promise<GeoPoint>{return new Promise((resolve,reject)=>api.getCurrentPosition(p=>{try{resolve(sharedLocation(p));}catch(e){reject(e);}},()=>reject(Error('Location was not shared. An area or landmark is enough.')),{enableHighAccuracy:false,timeout:10000,maximumAge:0}));}
export function locationLabel(location:CaseLocation){return location.kind==='shared'?`Shared device position · ±${Math.round(location.accuracy??0)} m`:location.kind==='synthetic'?'Synthetic demo coordinate':location.kind==='area'?'Area only · exact position unknown':'Location unknown';}
export function mapPosition(location:CaseLocation):{lat:number;lng:number}|null{return location.kind==='shared'||location.kind==='synthetic'?{lat:location.lat,lng:location.lng}:location.kind==='area'&&location.coverage?AREA_POINTS[location.coverage]:null;}
export function distanceLabel(a:CaseLocation,b:CaseLocation){if(a.kind!=='shared'||b.kind!=='shared')return 'Coverage context only · distance unknown';const r=Math.PI/180,dlat=(b.lat-a.lat)*r,dlng=(b.lng-a.lng)*r,h=Math.sin(dlat/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dlng/2)**2;return `Approx. ${(6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h))).toFixed(1)} km straight-line · not a route`;}
