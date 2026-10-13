# -*- coding: utf-8 -*-
"""数字员工工牌 PNG 合成脚本（像素/复古风，文字 100% 精确渲染）。"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"E:\code\github\poracode\docs\数字员工身份系统"
AVATARS = os.path.join(ROOT, "avatars")
BADGES = os.path.join(ROOT, "badges")
os.makedirs(BADGES, exist_ok=True)

BG = (12, 13, 16)
SURFACE = (21, 23, 28)
INK = (233, 230, 223)
MUTED = (155, 156, 163)
HAIRLINE = (42, 45, 53)

F_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
F_REG = r"C:\Windows\Fonts\msyh.ttc"
F_MONO = r"C:\Windows\Fonts\consola.ttf"

def font(path, size):
    return ImageFont.truetype(path, size)

def text_w(draw, txt, fnt):
    box = draw.textbbox((0, 0), txt, font=fnt)
    return box[2] - box[0]

def center(draw, img_w, txt, fnt, y, fill):
    draw.text(((img_w - text_w(draw, txt, fnt)) / 2, y), txt, font=fnt, fill=fill)

EMPLOYEES = [
    ("M-001", "顾衡", "总主管", "管理团队", 1, (59, 111, 224), "01-gu-heng.png", "事不过三，责不旁落。"),
    ("M-002", "苏澜", "测试主管", "管理团队", 2, (224, 52, 59), "02-su-lan.png", "流程走到哪，表单跟到哪。"),
    ("M-003", "严律", "测试项目主管", "管理团队", 3, (31, 122, 77), "03-yan-lv.png", "资料不齐，免谈。"),
    ("M-004", "贺章", "开发主管", "管理团队", 2, (47, 192, 106), "04-he-zhang.png", "每一条任务都有来处和去处。"),
    ("M-005", "祁文珊", "办公主管", "管理团队", 2, (201, 162, 75), "05-qi-wenshan.png", "机关材料，格式先行。"),
    ("T-101", "陆阅", "设计师（文档审查）", "测试执行团队", 3, (138, 79, 208), "06-lu-yue.png", "每一个含糊的句子都是缺陷的温床。"),
    ("T-102", "柯静", "设计师（静态分析）", "测试执行团队", 3, (43, 168, 192), "07-ke-jing.png", "代码不运行，问题照样现行。"),
    ("T-103", "秦守拙", "设计师（代码审查）", "测试执行团队", 3, (176, 106, 42), "08-qin-shouzhuo.png", "看代码要像看案情。"),
    ("T-104", "谭跃", "设计师（动态测试）", "测试执行团队", 3, (232, 138, 31), "09-tan-yue.png", "跑起来才知道哪里会塌。"),
    ("T-105", "叶述", "设计师（编写报告）", "测试执行团队", 3, (59, 168, 232), "10-ye-shu.png", "报告是给下一个人看的。"),
    ("T-106", "甄齐", "质量审查（表单）", "测试执行团队", 3, (208, 79, 154), "11-zhen-qi.png", "表格不齐整，流程不走下一步。"),
    ("T-107", "封鉴", "质量审查（报告）", "测试执行团队", 3, (90, 122, 154), "12-feng-jian.png", "盖章一时爽，责任一世扛。"),
]

W, H = 600, 900

def make_badge(no, name, role, dept, rank, color, avatar_file, motto):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    c = color
    # 外框（主色像素边框）
    d.rectangle([0, 0, W - 1, H - 1], outline=c, width=8)
    d.rectangle([14, 14, W - 15, H - 15], outline=HAIRLINE, width=2)
    # 四角像素块装饰
    for (x, y) in [(18, 18), (W - 42, 18), (18, H - 42), (W - 42, H - 42)]:
        d.rectangle([x, y, x + 22, y + 22], fill=c)
    # 内部表面
    d.rectangle([40, 40, W - 41, H - 41], fill=SURFACE)
    # 顶部条：部门（常驻与否按部门判定，不按职级：管理团队含职级 3 的常驻执行员工）
    f_dept = font(F_REG, 15)
    dept_txt = dept + (" · 永久员工" if dept == "管理团队" else " · 项目制临时工")
    center(d, W, dept_txt, f_dept, 56, MUTED)
    d.rectangle([120, 96, W - 120, 98], fill=HAIRLINE)
    # 头像（带主色边框）
    avatar = Image.open(os.path.join(AVATARS, avatar_file)).convert("RGB")
    avatar = avatar.resize((380, 380), Image.LANCZOS)
    ax = (W - 380) // 2
    ay = 118
    d.rectangle([ax - 8, ay - 8, ax + 388, ay + 388], outline=c, width=6)
    d.rectangle([ax - 8, ay - 8, ax + 388, ay + 388], outline=(0, 0, 0), width=1)
    img.paste(avatar, (ax, ay))
    # 工号（等宽大号，主色）
    f_no = font(F_MONO, 46)
    center(d, W, no, f_no, 520, c)
    # 姓名（粗体大号）
    f_name = font(F_BOLD, 54)
    center(d, W, name, f_name, 578, INK)
    # 分隔线
    d.rectangle([140, 668, W - 140, 670], fill=HAIRLINE)
    # 岗位 + 职级
    f_role = font(F_REG, 20)
    center(d, W, role, f_role, 690, INK)
    rank_txt = {1: "职级 1 · 总主管", 2: "职级 2 · 主管", 3: "职级 3 · 执行员工"}[rank]
    f_rank = font(F_REG, 15)
    center(d, W, rank_txt, f_rank, 726, MUTED)
    # 座右铭（主色 + 左侧条）
    motto_txt = "「" + motto + "」"
    f_motto = font(F_REG, 17)
    mw = text_w(d, motto_txt, f_motto)
    mx = (W - mw) // 2
    my = 776
    d.rectangle([mx - 14, my - 2, mx - 10, my + 24], fill=c)
    d.text((mx, my), motto_txt, font=f_motto, fill=c)
    # 底部
    f_footer = font(F_MONO, 14)
    center(d, W, "PORACODE · DIGITAL EMPLOYEE", f_footer, 852, MUTED)
    return img

badge_paths = []
for emp in EMPLOYEES:
    badge = make_badge(*emp)
    path = os.path.join(BADGES, f"{emp[0]}-{emp[1]}.png")
    badge.save(path)
    badge_paths.append(path)
    print("saved", path)

# 拼版：4 列 × 3 行
THUMB = (280, 420)
cols, rows = 4, 3
pad = 24
gw = THUMB[0] * cols + pad * (cols + 1)
gh = THUMB[1] * rows + pad * (rows + 1) + 90
sheet = Image.new("RGB", (gw, gh), BG)
ds = ImageDraw.Draw(sheet)
ds.text((pad, 24), "DIGITAL EMPLOYEE BADGES  ·  数字员工工牌  ·  12/12", font=font(F_BOLD, 30), fill=INK)
for i, emp in enumerate(EMPLOYEES):
    badge = Image.open(badge_paths[i]).convert("RGB").resize(THUMB, Image.LANCZOS)
    x = pad + (i % cols) * (THUMB[0] + pad)
    y = 90 + (i // cols) * (THUMB[1] + pad)
    ds.rectangle([x, y, x + THUMB[0], y + THUMB[1]], outline=emp[5], width=3)
    sheet.paste(badge, (x, y))
sheet_path = os.path.join(BADGES, "工牌拼版.png")
sheet.save(sheet_path)
print("saved", sheet_path)
