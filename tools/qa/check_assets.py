#!/usr/bin/env python3
import json,re,sys
from collections import Counter
from pathlib import Path
from html.parser import HTMLParser
ROOT=Path(__file__).resolve().parents[2]
A=ROOT/'app/src/main/assets'; html=(A/'index.html').read_text('utf-8')
module_refs=re.findall(r'<script\b[^>]*\bsrc="(js/app/[^"?#]+)',html)
core_refs=re.findall(r'<script\b[^>]*\bsrc="(js/core/[^"?#]+)',html)
app_files=sorted(path.relative_to(A).as_posix() for path in (A/'js/app').glob('*.js'))
core_files=sorted(path.relative_to(A).as_posix() for path in (A/'js/core').glob('*.js'))
style_refs=re.findall(r'<link\b[^>]*\bhref="(css/[^"?#]+)',html)
style_files=sorted(path.relative_to(A).as_posix() for path in (A/'css').glob('*.css'))
js='\n'.join((A/rel).read_text('utf-8') for rel in module_refs if (A/rel).exists())

VOID_ELEMENTS=frozenset({
 'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr',
})
FOREIGN_ROOTS=frozenset({'svg','math'})
P_START_CLOSERS=frozenset({
 'address','article','aside','blockquote','details','div','dl','fieldset','figcaption','figure',
 'footer','form','h1','h2','h3','h4','h5','h6','header','hgroup','hr','main','menu','nav',
 'ol','p','pre','search','section','table','ul',
})
OPTIONAL_START_CLOSERS={
 'head':frozenset({'body'}),
 'li':frozenset({'li'}),
 'dt':frozenset({'dt','dd'}),
 'dd':frozenset({'dt','dd'}),
 'p':P_START_CLOSERS,
 'rb':frozenset({'rb','rt','rtc','rp'}),
 'rt':frozenset({'rt','rp'}),
 'rtc':frozenset({'rb','rtc','rp'}),
 'rp':frozenset({'rt','rp'}),
 'option':frozenset({'option','optgroup'}),
 'optgroup':frozenset({'optgroup'}),
 'colgroup':frozenset({'caption','colgroup','tbody','thead','tfoot','tr'}),
 'thead':frozenset({'tbody','tfoot'}),
 'tbody':frozenset({'tbody','tfoot'}),
 'tr':frozenset({'tr'}),
 'td':frozenset({'td','th'}),
 'th':frozenset({'td','th'}),
}
OPTIONAL_END_CLOSERS={
 'head':frozenset({'html'}),
 'body':frozenset({'html'}),
 'li':frozenset({'ul','ol','menu'}),
 'dt':frozenset({'dl'}),
 'dd':frozenset({'dl'}),
 'rb':frozenset({'ruby'}),
 'rt':frozenset({'ruby'}),
 'rtc':frozenset({'ruby'}),
 'rp':frozenset({'ruby'}),
 'option':frozenset({'select','datalist','optgroup'}),
 'optgroup':frozenset({'select'}),
 'colgroup':frozenset({'table'}),
 'tbody':frozenset({'table'}),
 'tfoot':frozenset({'table'}),
 'tr':frozenset({'table','tbody','thead','tfoot'}),
 'td':frozenset({'table','tbody','thead','tfoot','tr'}),
 'th':frozenset({'table','tbody','thead','tfoot','tr'}),
}
EOF_OPTIONAL_TAGS=frozenset({
 'html','head','body','li','dt','dd','p','rb','rt','rtc','rp','option','optgroup','colgroup',
 'tbody','tfoot','tr','td','th',
})
P_OMISSION_FORBIDDEN_PARENTS=frozenset({'a','audio','del','ins','map','noscript','video'})

class StructureParser(HTMLParser):
 CDATA_CONTENT_ELEMENTS=('script','style','title','textarea','xmp','iframe','noembed','noframes')
 def __init__(self):
  super().__init__()
  self.stack=[]
  self.structure_errors=[]
  self.finished=False

 def _position(self):
  line,column=self.getpos()
  return line,column+1

 def _record_attributes(self,t,attrs):
  pass

 def _close_for_start(self,incoming):
  while self.stack and incoming in OPTIONAL_START_CLOSERS.get(self.stack[-1][0],()):
   self.stack.pop()

 def handle_starttag(self,t,attrs):
  t=t.lower()
  self._record_attributes(t,attrs)
  self._close_for_start(t)
  if t not in VOID_ELEMENTS:
   line,column=self._position()
   self.stack.append((t,line,column))

 def handle_startendtag(self,t,attrs):
  t=t.lower();self._record_attributes(t,attrs)
  # '/>' only self-closes void or SVG/MathML foreign-content elements. In ordinary HTML,
  # '<div/>' is parsed as an opening div and must still be reported as unclosed.
  in_foreign=t in FOREIGN_ROOTS or any(tag in FOREIGN_ROOTS for tag,_,_ in self.stack)
  if t not in VOID_ELEMENTS and not in_foreign:
   line,column=self._position();self.stack.append((t,line,column))

 def _can_omit_before_end(self,open_tag,closing_tag,parent_tag):
  if open_tag=='p':
   return (closing_tag==parent_tag and parent_tag not in P_OMISSION_FORBIDDEN_PARENTS
           and (not parent_tag or '-' not in parent_tag))
  return closing_tag in OPTIONAL_END_CLOSERS.get(open_tag,())

 def handle_endtag(self,t):
  t=t.lower()
  while self.stack:
   parent=self.stack[-2][0] if len(self.stack)>1 else None
   if not self._can_omit_before_end(self.stack[-1][0],t,parent):break
   self.stack.pop()
  if self.stack and self.stack[-1][0]==t:
   self.stack.pop()
   return

  line,column=self._position()
  matching_index=next((i for i in range(len(self.stack)-1,-1,-1) if self.stack[i][0]==t),None)
  if matching_index is None:
   self.structure_errors.append(
    f'html structure line {line}, column {column}: unexpected closing tag </{t}>'
   )
   return

  expected,opened_line,opened_column=self.stack[-1]
  self.structure_errors.append(
   f'html structure line {line}, column {column}: mismatched closing tag </{t}>; '
   f'expected </{expected}> for <{expected}> opened at line {opened_line}, column {opened_column}'
  )
  # Recover at the explicit ancestor close so one mistake does not create noisy EOF duplicates.
  del self.stack[matching_index:]

 def _can_omit_at_eof(self,tag,parent):
  if tag not in EOF_OPTIONAL_TAGS:return False
  if tag=='p':
   return parent not in P_OMISSION_FORBIDDEN_PARENTS and (not parent or '-' not in parent)
  return True

 def finish(self):
  if self.finished:return
  self.finished=True
  while self.stack:
   parent=self.stack[-2][0] if len(self.stack)>1 else None
   if not self._can_omit_at_eof(self.stack[-1][0],parent):break
   self.stack.pop()
  for tag,line,column in reversed(self.stack):
   self.structure_errors.append(
    f'html structure line {line}, column {column}: unclosed tag <{tag}>'
   )

class P(StructureParser):
 def __init__(self):
  super().__init__();self.ids=[];self.refs=[]
 def _record_attributes(self,t,attrs):
  d=dict(attrs)
  if 'id' in d:self.ids.append(d['id'])
  for k,v in attrs:
   if k.startswith('on') and v:self.refs += re.findall(r'\b([A-Za-z_$][\w$]*)\s*\(',v)

def validate_html_structure(source):
 parser=StructureParser();parser.feed(source);parser.close();parser.finish()
 return parser.structure_errors

def run_structure_self_test():
 valid='''<!doctype html>
<html><head><title>ok</title><style>.x::before{content:"</span>"}</style>
<body><p>intro<div>body<br><input></div><ul><li>one<li>two</ul>
<table><tbody><tr><td>left<td>right</table><select><optgroup><option>a<option>b</select>
<textarea><div>this is text, not markup</span></textarea>
<script>const sample = "<div></span>"; if (1 < 2) sample.length;</script>
<svg><path d="M0 0"/></svg>'''
 mismatched='<main>\n  <section><span>text</section>\n</main>'
 unclosed='<main>\n  <section></section>'
 html_self_close='<main><div/></main>'
 failures=[]
 if validate_html_structure(valid):failures.append('valid HTML5/raw-text sample was rejected')
 mismatch_errors=validate_html_structure(mismatched)
 if not any('line 2, column 22' in e and 'mismatched closing tag </section>' in e
            and 'expected </span>' in e and 'opened at line 2, column 12' in e for e in mismatch_errors):
  failures.append('mismatched closing-tag sample was not diagnosed precisely')
 unclosed_errors=validate_html_structure(unclosed)
 if not any('unclosed tag <main>' in e and 'line 1, column 1' in e for e in unclosed_errors):
  failures.append('unclosed-tag sample was not diagnosed precisely')
 if not any('mismatched closing tag </main>' in e and 'expected </div>' in e
            for e in validate_html_structure(html_self_close)):
  failures.append('ordinary HTML self-closing syntax was incorrectly accepted')
 index_errors=validate_html_structure(html)
 if index_errors:failures.append('current index.html was rejected: '+'; '.join(index_errors))
 if failures:
  print('\n'.join(failures),file=sys.stderr);return 1
 print('html structure self-test passed (HTML5/raw text, mismatch, unclosed, current index.html)')
 return 0

if sys.argv[1:]:
 if sys.argv[1:]==['--self-test']:sys.exit(run_structure_self_test())
 print('usage: check_assets.py [--self-test]',file=sys.stderr);sys.exit(2)

p=P();p.feed(html);p.close();p.finish()
errors=list(p.structure_errors)
if sorted(module_refs)!=app_files or len(module_refs)!=len(set(module_refs)):errors.append('app module inventory mismatch: '+','.join(module_refs))
if sorted(core_refs)!=core_files or len(core_refs)!=len(set(core_refs)):errors.append('core module inventory mismatch: '+','.join(core_refs))
# Third-party stylesheets live under css/vendor/<package-version>/ and are only checked for existence below.
first_party_style_refs=[ref for ref in style_refs if not ref.startswith('css/vendor/')]
if sorted(first_party_style_refs)!=style_files or len(style_refs)!=len(set(style_refs)):errors.append('style inventory mismatch: '+','.join(style_refs))
dup=sorted(x for x, count in Counter(p.ids).items() if count > 1)
if dup:errors.append('duplicate ids: '+','.join(dup))
defs=set(re.findall(r'(?:function\s+|(?:const|let|var)\s+)([A-Za-z_$][\w$]*)',js)); built={'event','document','window','setTimeout','child','click','getElementById','querySelector','if','preventDefault'}
missing=sorted(set(p.refs)-defs-built)
if missing:errors.append('missing handlers: '+','.join(missing))
for rel in re.findall(r'(?:src|href)="([^"]+)"',html):
 if rel.startswith(('http:','https:','data:','#')):continue
 local_rel=rel.split('?',1)[0].split('#',1)[0]
 if not (A/local_rel).exists():errors.append('missing asset: '+rel)
for path in A.rglob('*'):
 if path.is_file() and path.suffix.lower() in {'.js','.css','.html','.json','.txt'} and b'\r\n' in path.read_bytes():errors.append('asset text must use LF: '+path.relative_to(ROOT).as_posix())
# Opaque srcdoc card frontends eval the MVU runtime from its string form; both copies must stay byte-identical.
def embedded_mvu_runtime():
 prefix='self.__yeyuMvuRuntimeVendorSource='; body=(A/'js/vendor/mvu-runtime-source-1.0.0.js').read_text('utf-8').split('\n',1)[-1]
 if not (body.startswith(prefix) and body.endswith(';\n')):return None
 try:return json.loads(body[len(prefix):-2])
 except ValueError:return None
if embedded_mvu_runtime()!=(A/'js/vendor/mvu-runtime-1.0.0.js').read_text('utf-8'):errors.append('js/vendor/mvu-runtime-source-1.0.0.js is out of sync with mvu-runtime-1.0.0.js')
for rel in re.findall(r'(?:src|href)="((?:css|js)/[^"]*[?#][^"]*)"',html):errors.append('bundled asset must not carry a cache key: '+rel)
print(f'ids={len(p.ids)} handlers={len(set(p.refs))}')
if errors: print('\n'.join(errors),file=sys.stderr);sys.exit(1)
print('asset checks passed')
