#!/usr/bin/env node
import fs from 'node:fs';
const read=path=>fs.readFileSync(path,'utf8'),errors=[];
const check=(ok,msg)=>{if(!ok)errors.push(msg)};
const tokens=read('css/tokens.css'),siteCss=read('css/style.css'),cmsHtml=read('admin/index.html'),cmsJs=read('admin/admin.js'),cmsCss=read('admin/admin.css');
const guard=cmsJs.slice(cmsJs.indexOf('const CMS_WRITABLE_PATHS'),cmsJs.indexOf('function apiPath')),workflow=read('.github/workflows/site-validation.yml');
for(const token of ['--lm-color-background','--lm-color-surface','--lm-color-text-primary','--lm-color-accent','--lm-color-focus','--lm-color-danger','--lm-color-success','--lm-color-warning','--lm-font-sans','--lm-font-display','--lm-font-label','--lm-font-accent','--lm-type-size-base','--lm-shape-card-radius','--lm-page-gutter','--lm-glass-blur','--lm-motion-standard','--lm-space-4','--lm-elevation-card']){
 const matches=tokens.match(new RegExp('^[\\t ]*'+token+'[\\t ]*:','gm'))||[];check(matches.length===1,'Expected one declaration for '+token+'.');
}
check(/^@import url\('\.\/tokens\.css(?:\?[^']*)?'\);/.test(siteCss),'style.css must import shared tokens first.');
check(cmsHtml.includes('data-section="designSystem"')&&cmsHtml.includes('dirty-designSystem'),'CMS sidebar must expose Design System and its dirty marker.');
check(cmsJs.includes("designSystem: { file: 'css/tokens.css', label: 'Design System', rawText: true }"),'CMS router must register the token section.');
check(cmsJs.includes('RENDERERS.designSystem=async function')&&cmsJs.includes("if(section === 'designSystem')"),'CMS router must render the raw token editor.');
check(guard.includes("'css/tokens.css'"),'CMS allowlist must explicitly include the token source.');
check(cmsJs.includes("GH.commitFiles([{path:filePath,content:obj.text,encoding:'utf-8',expectedSha:obj.sha,textFile:true}]"),'Save must use the guarded atomic commit path.');
check(cmsJs.includes('data-ds-token')&&cmsJs.includes('dsReplaceToken'),'Controls must replace approved token declarations only.');
check(cmsCss.includes('.ds-shell')&&cmsCss.includes('@media(max-width:600px)'),'Design System layout must be responsive.');
check(workflow.includes('node tools/validate-design-system.mjs'),'CI must run the Design System contract test.');
check(workflow.includes('node tools/smoke-design-system.mjs'),'CI must run the Design System browser smoke test.');
for(const page of ['index.html','about/index.html','404.html','success/index.html'])check(read(page).includes('style.css?v=20261030-02'),page+' needs the latest stylesheet cache version.');
if(errors.length){console.error('Design System validation failed:');errors.forEach(e=>console.error(' - '+e));process.exitCode=1;}else console.log('Design System contract passed.');
