#!/usr/bin/env python3
"""تطبیق ۵ رکورد موجود در جدول signals (Turso) با حقیقت کندل بایننس.
بدون تغییر داده — فقط گزارش مغایرت اعداد ورود/تسویه و وضعیت روند."""
import json
import os
import time
import urllib.request
import urllib.error

TURSO_BASE = os.environ['TURSO_URL'].replace('libsql://', 'https://') + '/v2/pipeline'
TOK = os.environ['TURSO_JWT']


def run(stmts):
    body = {'requests': [{'type': 'execute', 'stmt': {'sql': s}} for s in stmts] + [{'type': 'close'}]}
    req = urllib.request.Request(TURSO_BASE, data=json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {TOK}',
                                          'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def rows_of(res):
    result = res['results'][0]['response']['result']
    rows = result['rows']
    cols = [c['name'] if isinstance(c, dict) else c for c in result['cols']]
    return [dict(zip(cols, [c.get('value') if isinstance(c, dict) else c for c in row])) for row in rows]


def binance_candle(symbol: str, open_ms: int):
    url = (f'https://data-api.binance.vision/api/v3/klines?symbol={symbol}'
           f'&interval=5m&startTime={open_ms}&endTime={open_ms + 299_999}&limit=1')
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            raw = json.load(r)
        if not raw:
            return None
        row = raw[0]
        return {'open': float(row[1]), 'high': float(row[2]), 'low': float(row[3]),
                'close': float(row[4]), 'time': int(row[0])}
    except Exception as e:
        print('  binance fetch error:', e)
        return None


r = run(["SELECT sql FROM sqlite_master WHERE name = 'signals'"])
print('FULL SCHEMA signals:')
print(r['results'][0]['response']['result']['rows'][0][0]['value'])

r = run(['SELECT * FROM signals ORDER BY candle_open_time DESC LIMIT 10'])
rows = rows_of(r)
print(f'\nROW COUNT: {len(rows)}')
print('=' * 100)

mismatch = 0
for row in rows:
    symbol = row.get('asset_id') or 'BTCUSDT'
    open_ms = int(row['candle_open_time'])
    close_ms = int(row['candle_close_time'])
    direction = row['direction']
    entry = float(row['entry_price'])
    close = float(row['close_price']) if row.get('close_price') is not None else None
    status = row['status']
    decimals = row.get('decimals')
    dec = int(decimals) if decimals not in (None, '') else 2

    truth = binance_candle(symbol, open_ms)
    print(f"\nid={row['id']}  {symbol}  {direction}  status={status}")
    print(f"  ورود ثبت‌شده در اپ:      {entry:.{dec}f}")
    print(f"  تسویهٔ ثبت‌شده در اپ:     {close:.{dec}f}" if close is not None else '  تسویه: —')
    if truth:
        print(f"  حقیقت بایننس (open):     {truth['open']:.{dec}f}")
        print(f"  حقیقت بایننس (close):    {truth['close']:.{dec}f}")
        q = lambda v: round(v, dec)
        entry_q, close_q = q(entry), q(truth['close'])
        if entry_q == close_q:
            expect = 'TIE'
        else:
            expect = 'WIN' if (direction == 'CALL') == (close_q > entry_q) else 'LOSS'
        same_close = abs(q(close) - q(truth['close'])) < 10 ** -dec / 2 if close is not None else None
        same_entry = abs(entry_q - q(truth['open'])) < 10 ** -dec / 2
        status_ok = status == expect or expect == 'TIE'
        print(f"  وضعیت درست محاسبه‌شده:   {expect}  |  عدد تسویه درست؟ {same_close}  |  ورود قفل به open؟ {same_entry}")
        if close is not None and not same_close:
            mismatch += 1
    else:
        print('  حقیقت بایننس: در دسترس نیست')

print('\n' + '=' * 100)
print(f'رکوردهایی با عدد تسویهٔ ناهم‌خوان با بایننس: {mismatch} از {len(rows)}')
