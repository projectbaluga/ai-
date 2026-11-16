#!/usr/bin/env node
import readline from "node:readline";
const totals={invalidResponses:0,modelFailures:0,completedRequests:0,retries:0,latencySamples:0,totalLatencyMs:0};
const fields=new Map();
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
function embedded(line){const i=line.indexOf("{");if(i<0)return null;try{return JSON.parse(line.slice(i));}catch{return null;}}
function inspect(value){
 const message=String(value.message??value.event??"");const payload=embedded(message)??value;
 if(message.includes("invalid_model_response")||payload.event==="invalid_model_response"){
  totals.invalidResponses++;for(const field of payload.issueFields??(payload.validationIssues??[]).map(issue=>String(issue).split(":")[0]))fields.set(field,(fields.get(field)??0)+1);
  totals.retries+=Number(payload.retryCount??(payload.retryAttempted?1:0));
 }else if(message.includes("model_request_failed")||payload.event==="model_request_failed"){totals.modelFailures++;totals.retries+=Number(payload.retryCount??0);}
 else if(message.includes("assistant_request_completed")||payload.event==="assistant_request_completed"){totals.completedRequests++;totals.retries+=Number(payload.retryCount??0);}
 if(Number.isFinite(Number(payload.latencyMs))){totals.latencySamples++;totals.totalLatencyMs+=Number(payload.latencyMs);}
}
for await(const line of input){if(!line.trim())continue;try{inspect(JSON.parse(line));}catch{inspect({message:line});}}
const ranked=[...fields.entries()].sort((a,b)=>b[1]-a[1]);
process.stdout.write(JSON.stringify({...totals,averageLatencyMs:totals.latencySamples?Math.round(totals.totalLatencyMs/totals.latencySamples):null,validationIssueFields:Object.fromEntries(ranked),mostCommonFailureField:ranked[0]?.[0]??null},null,2)+"\n");
