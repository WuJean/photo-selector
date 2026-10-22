#!/usr/bin/env python3
"""Draw original geometric app artwork using only the standard library."""
from pathlib import Path
import struct, zlib, math
size = 1024
def rounded(x,y,left,top,right,bottom,radius):
    cx=max(left+radius,min(right-radius,x)); cy=max(top+radius,min(bottom-radius,y))
    return (x-cx)**2+(y-cy)**2 <= radius**2
def triangle(x,y,a,b,c):
    def cross(p,q): return (x-q[0])*(p[1]-q[1])-(p[0]-q[0])*(y-q[1])
    vals=[cross(a,b),cross(b,c),cross(c,a)]
    return not(min(vals)<0<max(vals))
rows=[]
for y in range(size):
    row=bytearray([0])
    for x in range(size):
        color=(16,17,21)
        if rounded(x,y,155,170,795,780,50): color=(201,137,82)
        if rounded(x,y,180,195,770,755,30): color=(16,17,21)
        if rounded(x,y,225,245,865,855,50): color=(250,199,128)
        if rounded(x,y,250,270,840,830,30): color=(33,36,41)
        if (x-715)**2+(y-390)**2<55**2: color=(250,199,128)
        if triangle(x,y,(285,745),(465,440),(670,745)) or triangle(x,y,(540,745),(690,550),(805,745)): color=(250,199,128)
        row.extend(color)
    rows.append(row)
def chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows),9))+chunk(b'IEND',b'')
path=Path(__file__).resolve().parents[1]/'ios/PhotoSelector/Assets.xcassets/AppIcon.appiconset/AppIcon.png'
path.write_bytes(data)
print(path)
