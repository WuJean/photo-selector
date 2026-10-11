import {test,expect} from '@playwright/test';
import sharp from 'sharp';
const jpeg=async(color,index=0)=>sharp(Buffer.from(`<svg width="800" height="600"><rect width="800" height="600" fill="${color}"/><circle cx="${150+index*120}" cy="140" r="60" fill="#f2deb7"/><path d="M0 600 L270 160 L500 600 M300 600 L620 280 L800 600" fill="#536b64"/><path d="M210 260 L270 160 L330 260 Z" fill="#f1f4eb"/></svg>`)).jpeg().toBuffer();
test('real photo import, favorite, cull, undo, compare, collection and reload',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.getByRole('button',{name:'新建旅行',exact:true}).click();await page.getByRole('dialog').getByRole('textbox').fill('界面验收 '+Date.now());await page.getByRole('button',{name:'确定',exact:true}).click();
 await expect(page.getByRole('heading',{name:'把旅途带进来'})).toBeVisible();
 await page.locator('input[type=file]:not([webkitdirectory])').setInputFiles([{name:'雪山近景.jpg',mimeType:'image/jpeg',buffer:await jpeg('#a6bcc0')},{name:'雪山远景.jpg',mimeType:'image/jpeg',buffer:await jpeg('#b6bfa8',1)}]);
 await expect(page.locator('.photo-card').first()).toBeVisible();await expect(page.getByRole('status')).toContainText('已导入 2 张');
 await page.getByTitle('显示全部照片').click();await expect(page.locator('.photo-card')).toHaveCount(2);
 await page.locator('.photo-card').first().click();await page.keyboard.press('f');await expect(page.locator('.photo-heart').first()).toBeVisible();await page.keyboard.press('p');await expect(page.locator('.keep-badge').first()).toBeVisible();
 await page.getByTitle('撤销 ⌘Z').click();await expect(page.locator('.keep-badge')).toHaveCount(0);await expect(page.locator('.photo-heart')).toHaveCount(1);
 await page.keyboard.press('p');await page.getByRole('button',{name:'对比',exact:true}).click();await expect(page.getByRole('dialog',{name:'照片预览'})).toBeVisible();await page.getByRole('button',{name:'关闭',exact:true}).click();
 await page.getByRole('button',{name:'加入新作品集',exact:true}).click();await page.getByRole('dialog').getByRole('textbox').fill('朋友圈精选');await page.getByRole('button',{name:'确定',exact:true}).click();await expect(page.locator('.collection-tray')).toBeVisible();
 await page.reload();await expect(page.locator('.photo-card').first()).toBeVisible();await expect(page.locator('.photo-heart').first()).toBeVisible();
 await page.screenshot({path:'test-results/library.png',fullPage:true});expect(errors).toEqual([]);
});
