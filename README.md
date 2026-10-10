# Three-Body Hello World

基于 Vite + Three.js 的三体动画与镜面文字展示。

支持鼠标左键或单指拖动视角，聚焦画布后也可使用 `Shift + 方向键`。

采用随机初态与平滑运动约束，减少长期逃逸和双星锁定；以视觉效果为主，不追求严格物理真实性。三轴等比例显示，不自动取景。

```bash
nvm install
npm ci
npm run dev
```

构建：`npm run build` · 预览：`npm run preview` · 测试：`npm test`

批量运动检查：`npm run test:motion`，验证 24 组初态各 20 分钟的运动表现。

## 文件结构

```text
.
├── index.html                      # 页面入口
├── public/
│   └── favicon.svg                 # 站点图标
├── src/
│   ├── main.js                     # 场景启动入口
│   ├── style.css                   # 页面样式
│   ├── assets/
│   │   └── helvetiker_bold.typeface.json  # 三维文字字体
│   ├── scene/
│   │   ├── mirror-monument-scene.js # 场景生命周期与动画编排
│   │   ├── body-visuals.js          # 天体与轨迹渲染
│   │   ├── mirror-monument.js       # 镜面文字与反射
│   │   └── viewport.js             # 视口与恢复投影计算
│   └── simulation/
│       └── physics.js              # 三体物理模拟
├── test/
│   ├── physics.test.js             # 物理模拟测试
│   └── viewport.test.js            # 视口与恢复行为测试
├── package.json                    # 依赖与开发命令
├── package-lock.json               # 依赖版本锁定
└── vite.config.js                  # 本地开发与预览配置
```
