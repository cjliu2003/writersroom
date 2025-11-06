# Movie Poster Banner - Testing Guide

## Quick Start Testing

### 1. Start Development Server
```bash
cd /Users/ltw/Desktop/writersroom/frontend
npm run dev
```

### 2. Open Sign-In Page
Navigate to: http://localhost:3102

**Expected Result**:
- ✅ Animated movie posters scrolling left in background
- ✅ Login card appears with backdrop blur effect
- ✅ Posters are slightly blurred and desaturated
- ✅ Animation is smooth (60fps)

---

## Visual Testing

### What You Should See

#### Background Layer
- **10 movie posters** scrolling horizontally
- **Opacity**: ~40% (subtle, not overwhelming)
- **Effect**: Blurred (2px) + grayscale (30%)
- **Speed**: Slow, gentle scroll (~40 seconds per loop)
- **Seamless**: No visible jump when loop resets

#### Login Card
- **Position**: Centered on screen, above poster layer
- **Background**: Dark slate with strong blur effect
- **Border**: Subtle slate-700 border
- **Shadow**: Enhanced drop shadow for depth

#### Animation Behavior
- **Continuous**: Never stops (unless reduced motion)
- **Smooth**: No stuttering or frame drops
- **Hover**: Pauses when mouse over banner area
- **Resume**: Continues when mouse leaves

---

## Accessibility Testing

### Test 1: Reduced Motion Support

**macOS**:
1. System Preferences → Accessibility → Display
2. Enable "Reduce motion"
3. Reload sign-in page
4. **Expected**: Animation stops completely, opacity reduces to 20%

**Windows**:
1. Settings → Ease of Access → Display
2. Enable "Show animations in Windows"
3. Reload sign-in page
4. **Expected**: Animation stops

### Test 2: Screen Reader
1. Enable VoiceOver (macOS) or NVDA (Windows)
2. Tab through page
3. **Expected**:
   - Screen reader skips poster banner entirely
   - First tab goes to "Sign in with Google" button
   - Banner is announced as decorative/hidden

### Test 3: Keyboard Navigation
1. Press Tab key repeatedly
2. **Expected**:
   - Focus goes directly to login button
   - No focus on poster images
   - No keyboard trap

---

## Performance Testing

### Browser DevTools

**Chrome/Edge**:
1. Open DevTools (F12)
2. Go to Performance tab
3. Click Record
4. Wait 10 seconds
5. Stop recording
6. **Expected**:
   - Main thread mostly idle
   - Animation runs on compositor thread
   - FPS stays at 60
   - CPU usage <5%

**Check Animation**:
1. DevTools → More Tools → Rendering
2. Enable "Frame Rendering Stats"
3. **Expected**: Consistent 60fps

### Lighthouse Audit
```bash
npm run build
npm start
npx lighthouse http://localhost:3102 --view
```

**Target Scores**:
- Performance: 90+
- Accessibility: 100
- Best Practices: 95+
- SEO: 90+

---

## Functional Testing

### Test 1: Loading State
1. Open Network tab in DevTools
2. Throttle to "Slow 3G"
3. Reload page
4. **Expected**:
   - Skeleton animation appears while loading
   - Posters fade in when ready
   - No layout shift

### Test 2: API Failure Handling
1. Temporarily invalidate API key in `.env.local`
2. Reload page
3. **Expected**:
   - Gradient background appears (fallback)
   - No errors in console (warning only)
   - Login still functional

### Test 3: Hover Behavior
1. Hover mouse over poster area
2. **Expected**:
   - Animation pauses immediately
   - Posters remain visible
3. Move mouse away
4. **Expected**:
   - Animation resumes smoothly

---

## Browser Compatibility Testing

### Desktop Browsers
- [ ] Chrome 90+ (Windows/macOS)
- [ ] Firefox 88+ (Windows/macOS)
- [ ] Safari 14+ (macOS)
- [ ] Edge 90+ (Windows)

### Mobile Browsers
- [ ] Safari (iOS 14+)
- [ ] Chrome (Android 10+)
- [ ] Firefox (Android 10+)

### Check For
- ✅ Animation smoothness
- ✅ Responsive layout
- ✅ Touch interaction
- ✅ Image loading

---

## Edge Cases Testing

### Test 1: No Internet Connection
1. Disable network
2. Load page
3. **Expected**:
   - Gradient fallback appears
   - Login form still usable
   - Graceful degradation

### Test 2: Very Slow Connection
1. Throttle to "Slow 3G"
2. Reload page
3. **Expected**:
   - Loading skeleton displays
   - Progressive image loading
   - No timeout errors

### Test 3: Small Screen (Mobile)
1. Resize browser to 375px width
2. **Expected**:
   - Posters scale appropriately
   - Login card remains centered
   - No horizontal scroll

### Test 4: Very Large Screen (4K)
1. Resize to 3840px width
2. **Expected**:
   - Posters fill screen width
   - No blank spaces
   - Smooth animation continues

---

## API Testing

### Verify TMDB Integration

**Test API Key**:
```bash
curl "https://api.themoviedb.org/3/movie/popular?api_key=c21c69c7d161fac76f20fb8c810a6864"
```

**Expected Response**:
```json
{
  "page": 1,
  "results": [
    {
      "id": 550,
      "title": "Fight Club",
      "poster_path": "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg"
      ...
    }
  ]
}
```

**Test Image URLs**:
```bash
curl -I "https://image.tmdb.org/t/p/w300/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg"
```

**Expected**: HTTP 200 OK

---

## Debugging Common Issues

### Issue: No Posters Appear
**Possible Causes**:
1. Invalid API key → Check `.env.local`
2. API rate limit → Wait and retry
3. Network blocked → Check firewall/CORS

**Debug Steps**:
```javascript
// Open browser console
console.log(process.env.NEXT_PUBLIC_TMDB_API_KEY);
// Should output: c21c69c7d161fac76f20fb8c810a6864
```

### Issue: Animation Stutters
**Possible Causes**:
1. Low-end device → Expected on very old hardware
2. Too many browser tabs → Close unnecessary tabs
3. GPU disabled → Check browser settings

**Debug Steps**:
1. Open DevTools → Performance
2. Check for long tasks (>50ms)
3. Verify GPU rendering (should be green in DevTools)

### Issue: Images Not Loading
**Possible Causes**:
1. CORS policy → Check network tab
2. TMDB CDN down → Rare, but possible
3. Ad blocker → Disable temporarily

**Debug Steps**:
1. Network tab → Filter by images
2. Check for 403/404 errors
3. Verify image URLs are correct

---

## Performance Benchmarks

### Expected Metrics

| Metric | Target | Good | Acceptable |
|--------|--------|------|------------|
| **FPS** | 60fps | 55-60fps | 45-60fps |
| **CPU Usage** | <5% | <8% | <12% |
| **Memory** | +2-3MB | +5MB | +8MB |
| **Load Time** | +100ms | +200ms | +300ms |
| **Image Size** | ~30KB/poster | ~40KB | ~50KB |

### Lighthouse Thresholds

| Category | Score | Notes |
|----------|-------|-------|
| **Performance** | 90-100 | Should maintain high score |
| **Accessibility** | 100 | Must be perfect |
| **Best Practices** | 95-100 | High standard |
| **SEO** | 90-100 | Metadata important |

---

## Regression Testing

Before deploying, verify:
- [ ] Login functionality still works
- [ ] Firebase authentication unaffected
- [ ] Dashboard loads after login
- [ ] Existing styles not broken
- [ ] Mobile responsiveness maintained
- [ ] Dark mode (if applicable) works

---

## Production Checklist

Before going live:
- [ ] API key is valid and working
- [ ] All images load correctly
- [ ] Animation is smooth across browsers
- [ ] Accessibility features tested
- [ ] Performance meets targets
- [ ] No console errors
- [ ] Lighthouse scores acceptable
- [ ] Mobile devices tested
- [ ] Reduced motion tested

---

## Support & Resources

### Documentation
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - Full technical details
- [TMDB API Docs](https://developers.themoviedb.org/3) - API reference
- [WCAG 2.1](https://www.w3.org/WAI/WCAG21/) - Accessibility standards

### Debugging Tools
- Chrome DevTools Performance tab
- Lighthouse CI
- WebPageTest.org
- Can I Use (browser compatibility)

### Quick Commands
```bash
# Development
npm run dev

# Production build
npm run build && npm start

# Type checking
npx tsc --noEmit

# Linting
npm run lint

# Lighthouse audit
npx lighthouse http://localhost:3102
```

---

**Last Updated**: 2025-10-28
**Status**: Ready for Testing
**Next Step**: Manual verification and deployment
