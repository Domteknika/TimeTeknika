// Keep the original six values so existing projects retain their colors.
export const PROJECT_COLORS = [
  {value:'#a88be0',name:'Lavande'},
  {value:'#e4a072',name:'Terracotta'},
  {value:'#75a8a0',name:'Sauge'},
  {value:'#729fd0',name:'Bleu'},
  {value:'#d57f99',name:'Rose'},
  {value:'#b29d61',name:'Sable'},
  {value:'#e4a09a',name:'Corail'},
  {value:'#edba9c',name:'Pêche'},
  {value:'#e8c086',name:'Abricot'},
  {value:'#d8cb83',name:'Citron'},
  {value:'#bbcc91',name:'Pistache'},
  {value:'#96c9b7',name:'Menthe'},
  {value:'#82bfcb',name:'Turquoise'},
  {value:'#9ba7da',name:'Pervenche'},
  {value:'#c1a0d4',name:'Lilas'}
];

export function projectColorOptions(selected=PROJECT_COLORS[0].value){
  const choices=[...PROJECT_COLORS];
  if(/^#[\da-f]{6}$/i.test(selected)&&!choices.some(c=>c.value===selected))choices.unshift({value:selected,name:'Couleur actuelle'});
  return choices.map(c=>`<option value="${c.value}"${c.value===selected?' selected':''}>${c.name}</option>`).join('');
}
