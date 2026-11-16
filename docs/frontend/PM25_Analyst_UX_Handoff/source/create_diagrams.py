from pathlib import Path
from xml.sax.saxutils import escape
import cairosvg
p=Path(__file__).resolve().parents[1]/'mockups'
W,H=1600,635
s=['''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="{W}" height="{H}" fill="#F2F5F9"/><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="none" stroke="#6D8498" stroke-width="1.5"/></marker><marker id="route" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6" fill="none" stroke="#2463D4" stroke-width="1.5"/></marker></defs>
<style>text{font-family:'Segoe UI',Inter,Arial,sans-serif;fill:#17283F}.label{font-size:14px;font-weight:700}.subtitle{font-size:13px;fill:#63788F}.small{font-size:12px;fill:#8393A6}.top{font-size:31px;font-weight:800;letter-spacing:-1px}.step{font-size:12px;font-weight:700;fill:#087E8B;letter-spacing:2px}.route{font-size:14px;font-weight:800;fill:#2463D4}</style>
<text x="60" y="63" class="step">PM2.5 EXPLORER · PRODUCT FLOW</text><text x="60" y="107" class="top">Từ dữ liệu thô đến quyết định của Analyst</text><text x="60" y="138" class="subtitle">M4 Visualization là nơi kiểm tra bối cảnh, không thay thế kết quả của thuật toán hoặc quyết định review.</text>''']
steps=[
 ('01','DATA EXPLORATION','Hiểu dữ liệu','Profile / Aggregates','Phạm vi và chất lượng','#087E8B'),
 ('02','ANALYSIS','Chạy detector','POST /analysis-runs','Scope được chốt trên Server','#2463D4'),
 ('03','ANALYSIS RESULTS','Xem phát hiện','GET /analysis-runs/:id','GET /anomalies?runId=...','#2463D4'),
 ('04','ANOMALIES','Điều tra điểm','List + Detail','Reading · trạm · timestamp','#087E8B'),
 ('05','REVIEW','Ghi nhận đánh giá','PATCH /anomalies/:id','open / confirmed / false_positive','#137A50')]
xs=[56,360,664,968,1272]
for i, (no,topic,title,api,desc,color) in enumerate(steps):
 x=xs[i];y=202
 s.append(f'<rect x="{x}" y="{y}" width="272" height="202" rx="16" fill="white" stroke="#DDE4EC"/><rect x="{x}" y="{y}" width="272" height="6" rx="4" fill="{color}"/>')
 s.append(f'<text x="{x+20}" y="{y+43}" class="step">{no} · {topic}</text><text x="{x+20}" y="{y+84}" font-size="22" font-weight="750">{title}</text><text x="{x+20}" y="{y+123}" class="subtitle">{escape(api)}</text><text x="{x+20}" y="{y+151}" class="subtitle">{escape(desc)}</text>')
 if i<4:
  s.append(f'<path d="M{x+272},{y+105} H{xs[i+1]-12}" stroke="#6D8498" stroke-width="2" marker-end="url(#arrow)" fill="none"/>')
s.append('''<rect x="56" y="470" width="1488" height="110" rx="16" fill="#EDF3FF" stroke="#C7DBF5"/><text x="79" y="506" class="route">VISUALIZATION M4 — KHÔNG THIẾT KẾ LẠI</text><text x="79" y="535" class="subtitle">Từ Exploration hoặc Anomaly: mở đúng trạm + vị trí + timestamp + readingId, giữ Mapbox / Cube / timeline / camera hiện có.</text><text x="79" y="560" class="small">Nếu reading nằm ngoài 2.000 điểm đã tải: truy vấn bounded bằng GET /readings theo sensorId + thời gian rồi xác minh exact ID; không giả kết quả.</text>''')
for x in [190,1110]:
 s.append(f'<path d="M{x} 406 V455" fill="none" stroke="#2463D4" stroke-width="2.2" stroke-dasharray="6 5" marker-end="url(#route)"/>')
s.append('<text x="1537" y="610" text-anchor="end" class="small">UX concept v1 · B5/B6/Exploration API đã có · 16.11.2026</text></svg>')
svg=''.join(s).replace('{W}',str(W)).replace('{H}',str(H))
(p/'00-user-flow.svg').write_text(svg,encoding='utf8')
cairosvg.svg2png(bytestring=svg.encode('utf8'),write_to=str(p/'00-user-flow.png'),output_width=1600,output_height=635)

# Palette and measurements visual sheet
colors=[('#F2F5F9','Workspace nền'),('#FFFFFF','Panel / surface'),('#17283F','Text chính'),('#5C6B80','Text phụ'),('#DDE4EC','Viền'),('#2463D4','CTA chính'),('#087E8B','Brand / series'),('#137A50','Completed'),('#A56A1C','Cảnh báo'),('#BD4747','Lỗi')]
s=[f'''<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="850" viewBox="0 0 1600 850"><rect width="1600" height="850" fill="#F2F5F9"/><style>text{{font-family:'Segoe UI',Arial,sans-serif;fill:#17283F}}.head{{font-size:31px;font-weight:800}}.label{{font-size:16px;font-weight:700}}.sub{{font-size:13px;fill:#697B90}}.num{{font-size:17px;font-weight:800}}</style><text x="64" y="76" class="head">Design tokens &amp; kích thước — giữ light mode hiện tại</text><text x="64" y="110" class="sub">CSS px · desktop base 1600px · theo client/src/app/styles.css + UX đề xuất</text>''']
for i,(c,label) in enumerate(colors):
 x=64+(i%5)*306;y=150+(i//5)*158
 s.append(f'<rect x="{x}" y="{y}" width="272" height="135" rx="12" fill="white" stroke="#DDE4EC"/><rect x="{x+16}" y="{y+16}" width="64" height="62" rx="10" fill="{c}" stroke="#CDD7E0"/><text x="{x+91}" y="{y+43}" class="label">{escape(label)}</text><text x="{x+91}" y="{y+68}" class="num">{c.upper()}</text><text x="{x+18}" y="{y+111}" class="sub">Color token</text>')
s.append('''<text x="64" y="520" class="label">Desktop layout spec</text><rect x="64" y="540" width="716" height="236" rx="14" fill="white" stroke="#DDE4EC"/>
<rect x="82" y="560" width="45" height="193" fill="#EAF5F8"/><rect x="141" y="560" width="621" height="26" rx="5" fill="#EAF2FF"/><rect x="141" y="598" width="621" height="31" rx="6" fill="#F7F9FC"/>
<rect x="141" y="641" width="190" height="109" rx="8" fill="#EEF3F8"/><rect x="343" y="641" width="419" height="109" rx="8" fill="#EEF3F8"/>
<text x="89" y="661" font-size="12" font-weight="800" transform="rotate(-90 89 661)">80px rail</text><text x="145" y="580" class="sub">Topbar 70px · main inset 32px</text><text x="145" y="620" class="sub">Tabs 47–51px · card gap 16px</text><text x="163" y="683" class="sub">Exploration</text><text x="163" y="704" class="num">30%</text><text x="360" y="683" class="sub">Chart panel</text><text x="360" y="704" class="num">70%</text>
<text x="835" y="520" class="label">Kích thước component</text><rect x="835" y="540" width="709" height="236" rx="14" fill="white" stroke="#DDE4EC"/>
<text x="855" y="582" class="sub">Control input: <tspan font-weight="800" fill="#17283F">42–44px</tspan> · Button: <tspan font-weight="800" fill="#17283F">40–44px</tspan></text>
<text x="855" y="624" class="sub">Card radius: <tspan font-weight="800" fill="#17283F">16px</tspan> · Padding desktop: <tspan font-weight="800" fill="#17283F">24px</tspan></text>
<text x="855" y="666" class="sub">H1: <tspan font-weight="800" fill="#17283F">24px</tspan> · H2: <tspan font-weight="800" fill="#17283F">26px</tspan> · Body: <tspan font-weight="800" fill="#17283F">14px/22px</tspan></text>
<text x="855" y="707" class="sub">Mobile: main inset <tspan font-weight="800" fill="#17283F">16px</tspan> · stack panels · touch ≥<tspan font-weight="800" fill="#17283F">44×44px</tspan></text>
<text x="1544" y="822" text-anchor="end" class="sub">Tài liệu handoff, không phải design system mới cho M4 Visualization</text></svg>''')
s=''.join(s);(p/'06-design-tokens.svg').write_text(s,encoding='utf8');cairosvg.svg2png(bytestring=s.encode('utf8'),write_to=str(p/'06-design-tokens.png'),output_width=1600,output_height=850)
print('generated diagrams',[(f.name,f.stat().st_size) for f in p.glob('*tokens*')])
