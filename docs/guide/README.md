# guide/

面向使用者本人的操作说明，不讲实现。

| 文件 | 内容 |
|------|------|
| [`usage.md`](usage.md) | 新界面各页怎么用、每天的固定动作（早上 / 收工 / 周五週報）、起票与补记的三种写法、出问题怎么排查、新机器怎么装、怎么配 `[projects]` 让 session 自动挂到案件、字体许可。网页上的说明页（`#/v2/usage`；旧地址 `#/usage` 会跳到这里）在构建时直接读这个文件，只改这里即可（改完要重新部署网页才会生效）。 |
| [`api.md`](api.md) | API reference (English): auth, `X-Lang` and optimistic-locking conventions, then every route grouped by area. Keep it in step with `server/src/routes/`. |
