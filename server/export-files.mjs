import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { exportColumn, displayExportCell, exportDuration } from '../public/export-config.js';

const date=day=>day.split('-').reverse().join('.');
const stamp=ms=>new Intl.DateTimeFormat('fr-CH',{timeZone:'Europe/Zurich',dateStyle:'short',timeStyle:'medium'}).format(ms);
export const exportFilename=(model,format)=>`TimeTeknika_${model.period.from}_${model.period.to}.${format}`;
const valueFor=(row,column,columns)=>{
  if(row.caption&&!exportColumn(column.key).metric)return column===columns.find(c=>!exportColumn(c.key).metric)?row.caption:'';
  return row[column.key]??'';
};
// CSV text never becomes an Excel formula when opened by a recipient.
const csvCell=value=>'"'+String(typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(value)?"'"+value:value).replaceAll('"','""')+'"';
export function csvExport(model) {
  const columns=model.config.columns;
  const lines=[columns.map(c=>csvCell(c.label)).join(';'),...model.rows.map(row=>columns.map(c=>csvCell(displayExportCell(c.key,valueFor(row,c,columns)))).join(';'))];
  return Buffer.from('\uFEFF'+lines.join('\r\n')+'\r\n','utf8');
}
export async function xlsxExport(model) {
  const wb=new ExcelJS.Workbook(),columns=model.config.columns,document=model.config.document;
  wb.creator='TimeTeknika';wb.created=new Date(model.asOf);wb.modified=new Date(model.asOf);
  const sheet=wb.addWorksheet('Prestations',{views:[{state:'frozen',ySplit:6}],pageSetup:{paperSize:9,orientation:columns.length>6?'landscape':'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'6:6'},headerFooter:{oddFooter:'TimeTeknika | &P / &N'}});
  sheet.columns=columns.map(c=>({key:c.key,width:Math.max(13,Math.min(42,exportColumn(c.key).width/6))}));
  const banner=(line,content)=>{sheet.getCell(line,1).value=content;if(columns.length>1)sheet.mergeCells(line,1,line,columns.length);};
  banner(1,document.title);banner(2,[document.company,document.reference&&'Référence : '+document.reference].filter(Boolean).join(' · '));
  banner(3,`Du ${date(model.period.from)} au ${date(model.period.to)} · Europe/Zurich`);
  banner(4,`${model.entryCount} entrées · arrêté au ${stamp(model.asOf)}${model.runningCount?' · '+model.runningCount+' chronos en cours inclus':''}`);
  sheet.getRow(1).font={name:'Arial',size:19,bold:true,color:{argb:'FF6E3039'}};sheet.getRow(1).height=34;
  [2,3,4].forEach(n=>{sheet.getRow(n).font={name:'Arial',size:10,color:{argb:'FF77767A'}};sheet.getRow(n).alignment={wrapText:true,vertical:'middle'};sheet.getRow(n).height=n===2?32:22;});
  sheet.getRow(6).values=columns.map(c=>c.label);sheet.getRow(6).height=30;
  sheet.getRow(6).eachCell(cell=>{cell.font={name:'Arial',size:10,bold:true,color:{argb:'FF6E3039'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF6E3E6'}};cell.alignment={wrapText:true,vertical:'middle'};});
  const detailRanges=[];
  model.rows.forEach((row,index)=>{
    const line=7+index,r=sheet.getRow(line),aggregate=['subtotal','total'].includes(row.type);
    r.height=aggregate?30:Math.max(27,Math.min(409,Math.max(...columns.map(c=>String(valueFor(row,c,columns)).length/(sheet.getColumn(c.key).width||20)))*12+12));
    if(!aggregate)detailRanges.push(line);
    columns.forEach((c,i)=>{
      const cell=r.getCell(i+1),value=valueFor(row,c,columns);
      cell.value=c.key==='duration'&&typeof value==='number'?value/86400:value;
      if(c.key==='duration')cell.numFmt='[h]:mm:ss';if(c.key==='decimal')cell.numFmt='0.00';
      cell.font={name:'Arial',size:10,bold:aggregate,color:{argb:aggregate?'FF6E3039':'FF303034'}};
      cell.alignment={vertical:'top',wrapText:true,horizontal:exportColumn(c.key).metric?'right':'left'};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:aggregate?'FFF6E3E6':index%2?'FFFAFAFA':'FFFFFFFF'}};
      cell.border={bottom:{style:'hair',color:{argb:'FFE9E7E8'}}};
      // Recalculate totals from ordinary data rows only, excluding the subtotals.
      if(row.type==='total'&&['duration','decimal'].includes(c.key)&&detailRanges.length){
        const ranges=[];for(const n of detailRanges){const last=ranges.at(-1);if(last&&last[1]===n-1)last[1]=n;else ranges.push([n,n]);}
        const letter=cell.address.replace(/\d+$/,'');const formula=`SUM(${ranges.map(([a,b])=>`${letter}${a}:${letter}${b}`).join(',')})`;
        if(formula.length<8000)cell.value={formula,result:c.key==='duration'?row.seconds/86400:row.seconds/3600};
      }
    });
    const prefix=columns.findIndex(c=>exportColumn(c.key).metric);
    if(aggregate&&prefix>1)sheet.mergeCells(line,1,line,prefix);
  });
  sheet.autoFilter={from:{row:6,column:1},to:{row:Math.max(6,6+model.rows.length),column:columns.length}};
  if(document.note){const n=sheet.rowCount+2;banner(n,document.note);sheet.getRow(n).alignment={wrapText:true,vertical:'top'};sheet.getRow(n).height=70;}
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function pdfExport(model) {
  const columns=model.config.columns,settings=model.config.document;
  const landscape=settings.orientation==='landscape'||settings.orientation==='auto'&&columns.reduce((n,c)=>n+exportColumn(c.key).width,0)>620;
  const doc=new PDFDocument({size:'A4',layout:landscape?'landscape':'portrait',margin:38,bufferPages:true,autoFirstPage:false,info:{Title:settings.title,Author:settings.company||'TimeTeknika',CreationDate:new Date(model.asOf)}});
  doc.registerFont('Regular',fileURLToPath(new URL('./fonts/LiberationSans-Regular.ttf',import.meta.url)));
  doc.registerFont('Bold',fileURLToPath(new URL('./fonts/LiberationSans-Bold.ttf',import.meta.url)));
  const chunks=[],done=new Promise((resolve,reject)=>{doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
  const margin=38,pageWidth=landscape?841.89:595.28,pageHeight=landscape?595.28:841.89,width=pageWidth-margin*2,bottom=pageHeight-52;
  // Wide exports continue in column bands; never shrink a dozen columns to illegible text.
  const bands=[];let band=[],used=0;
  for(const column of columns){const need=Math.max(64,exportColumn(column.key).width);if(band.length&&used+need>width-28){bands.push(band);band=[];used=0;}band.push(column);used+=need;}
  if(band.length)bands.push(band);
  const gutter=bands.length>1?28:0;
  let y=0,currentBand,currentWidths;
  const lineText=(text,x,top,w,size=9,bold=false,color='#303034')=>doc.font(bold?'Bold':'Regular').fontSize(size).fillColor(color).text(String(text),x,top,{width:w,lineGap:2});
  const height=(text,w,size=9,bold=false)=>doc.font(bold?'Bold':'Regular').fontSize(size).heightOfString(String(text),{width:w,lineGap:2});
  function header(continued=false){
    doc.addPage();doc.rect(margin,26,28,3).fill('#D095A4');
    const company=settings.company||'TimeTeknika';
    lineText(company,margin,40,width,10,true,'#A64E57');
    y=40+height(company,width,10,true)+10;
    lineText(settings.title,margin,y,width,continued?16:22,true);y+=height(settings.title,width,continued?16:22,true)+8;
    const meta=`Du ${date(model.period.from)} au ${date(model.period.to)}${settings.reference?'  |  Réf. '+settings.reference:''}`;
    lineText(meta,margin,y,width,9,false,'#77767A');y+=height(meta,width,9)+12;
    if(!continued){const overview=`${model.entryCount} entrées${model.config.total?'  ·  '+exportDuration(model.totalSeconds)+' travaillées':''}${model.runningCount?'  ·  '+model.runningCount+' chronos en cours inclus':''}`;lineText(overview,margin,y,width,10,true,'#6E3039');y+=height(overview,width,10,true)+14;}
    if(bands.length>1){const bandTitle=`Volet ${bands.indexOf(currentBand)+1} / ${bands.length} · Les numéros relient les mêmes lignes entre les volets.`;lineText(bandTitle,margin,y,width,8,false,'#77767A');y+=height(bandTitle,width,8)+9;}
    const h=Math.max(28,...currentBand.map((c,i)=>height(c.label,currentWidths[i]-14,9,true)+16));
    doc.rect(margin,y,width,h).fill('#F6E3E6');let x=margin+gutter;
    if(gutter)lineText('N°',margin+5,y+7,gutter-8,8,true,'#6E3039');
    currentBand.forEach((c,i)=>{lineText(c.label,x+7,y+7,currentWidths[i]-14,9,true,'#6E3039');x+=currentWidths[i];});y+=h;
  }
  function wrap(text,w,bold){
    // Explicit wrapping allows long descriptions to continue across pages without truncation.
    doc.font(bold?'Bold':'Regular').fontSize(9);const lines=[];
    for(const paragraph of String(text).split(/\r?\n/)){
      let line='';for(const word of paragraph.split(/\s+/)){
        if(line&&doc.widthOfString(line+' '+word)>w){lines.push(line);line='';}
        for(const char of word){if(doc.widthOfString(line+char)>w&&line){lines.push(line);line='';}line+=char;}
        line+=' ';
      }lines.push(line.trimEnd());
    }return lines.length?lines:[''];
  }
  for(const nextBand of bands){
    currentBand=nextBand;const base=currentBand.reduce((n,c)=>n+exportColumn(c.key).width,0);currentWidths=currentBand.map(c=>exportColumn(c.key).width/base*(width-gutter));header();
    for(let index=0;index<model.rows.length;index++){
      const row=model.rows[index],bold=['subtotal','total'].includes(row.type);
      let cells=currentBand.map((c,i)=>({key:c.key,text:displayExportCell(c.key,valueFor(row,c,currentBand)),width:currentWidths[i]}));
      const prefix=cells.findIndex(c=>exportColumn(c.key).metric);
      if(bold&&prefix>1)cells=[{key:cells[0].key,text:cells.slice(0,prefix).map(c=>c.text).filter(Boolean).join(' '),width:cells.slice(0,prefix).reduce((sum,c)=>sum+c.width,0)},...cells.slice(prefix)];
      if(gutter)cells.unshift({key:'__row',text:String(index+1),width:gutter});
      const lines=cells.map(c=>wrap(c.text,c.width-14,bold));
      let offset=0,count=Math.max(...lines.map(a=>a.length));
      while(offset<count){
        if(bottom-y<29)header(true);
        const take=Math.min(count-offset,Math.max(1,Math.floor((bottom-y-14)/13))),h=take*13+14;
        doc.rect(margin,y,width,h).fill(bold?'#F6E3E6':index%2?'#FAFAFA':'#FFFFFF');let x=margin;
        cells.forEach((c,i)=>{
          doc.font(bold?'Bold':'Regular').fontSize(9).fillColor(bold?'#6E3039':'#303034');
          (c.key==='__row'?[String(index+1)]:lines[i].slice(offset,offset+take)).forEach((line,n)=>doc.text(line,x+7,y+7+n*13,{width:c.width-14,lineBreak:false,align:exportColumn(c.key)?.metric?'right':'left'}));x+=c.width;
        });
        doc.moveTo(margin,y+h).lineTo(margin+width,y+h).strokeColor('#E9E7E8').lineWidth(.4).stroke();y+=h;offset+=take;
      }
    }
    if(!model.rows.length){lineText('Aucune prestation pour cette sélection.',margin,y+16,width,10);y+=42;}
  }
  if(settings.note){const noteLines=wrap(settings.note,width,false);y+=20;for(const line of noteLines){if(y+15>bottom){header(true);y+=15;}lineText(line,margin,y,width,9,false,'#77767A');y+=13;}}
  const range=doc.bufferedPageRange();
  for(let i=range.start;i<range.start+range.count;i++){
    doc.switchToPage(i);const previousBottom=doc.page.margins.bottom;doc.page.margins.bottom=0;
    doc.moveTo(margin,pageHeight-37).lineTo(pageWidth-margin,pageHeight-37).strokeColor('#E9E7E8').stroke();
    doc.font('Regular').fontSize(7).fillColor('#77767A').text(`TimeTeknika · ${stamp(model.asOf)} · Europe/Zurich`,margin,pageHeight-28,{lineBreak:false,width:width-65});
    doc.text(`${i+1} / ${range.count}`,pageWidth-margin-55,pageHeight-28,{lineBreak:false,width:55,align:'right'});
    doc.page.margins.bottom=previousBottom;
  }
  doc.end();return done;
}
