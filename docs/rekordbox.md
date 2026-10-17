# rekordbox 兼容交换（v0.4.1）

入口 `/lifestyle#rekordbox`。这是文件交换，不是实时自动同步，不读写加密数据库，不是官方认证插件，也不是完整曲库备份。依照 [AlphaTheta XML 交换规范](https://cdn.rekordbox.com/files/20200410160904/xml_format_list.pdf) 实现 1.0.0 格式；操作引导参考 [rekordbox 7 官方手册](https://cdn.rekordbox.com/files/20260409151936/rekordbox7.214_manual_EN.pdf) 的 Using rekordbox xml、Importing from rekordbox xml 以及 File 菜单。其他版本菜单可能不同。

## 建议流程

1. 先在 rekordbox 备份曲库，用独立测试歌单验证一次，尤其先核对文件路径和 Cue。
2. rekordbox：File → Export Collection in xml format，选择 UTF-8 XML 文件。
3. 本 App：兴趣与生活 → rekordbox → 选择 XML。按全库与歌单、仅曲库或一个歌单选择范围，点击预览，再明确确认。大库可仅导入某个歌单及引用曲目。
4. 在曲库维护音乐路径 / BPM / 调性 / Cue，在 Set Builder 选择下一首、调整曲序。播放段、转场和重叠是独立 Set 计划，不代表全局曲目 Cue。
5. 回到 rekordbox 页签，选全部或某套 Set，导出 XML。手动曲目也可导出，但须在编辑中补齐真实音频路径。不能用浏览器 File API 推断原电脑的完整路径。
6. rekordbox Preferences → View → Layout → Media Browser，启用 rekordbox xml；Preferences → Advanced → Database → rekordbox xml → Imported Library，选择该 XML。
7. 刷新树状导航的 rekordbox xml，展开 Playlists，将所需歌单拖入自己的 Playlists。只打开 XML 不代表已把元数据导入 Collection。

真实音频必须位于使用 rekordbox 的电脑上，且与 XML 中路径一致。Mac、Windows、中文、空格与符号转换为本机 file URI；移动电脑或磁盘后须重新定位。网页不检查文件是否存在，不打开 / 下载路径，也不支持远程共享、流媒体 URL 或云端专属文件。自动分析和已有 Cue 的覆盖行为由 rekordbox 版本 / 设置决定，本 App 不控制。

## 字段行为

| 信息 | 交换方式 |
| --- | --- |
| 曲名 / 艺人 / 风格 / 备注 / 时长 / BPM | 对应 XML 曲目信息；整数秒时长，小数 BPM，空值不伪装成已分析 |
| 调性 | Camelot 与常见音乐调性转换；未知字符串保留原始 Tonality，推荐仍为未知；明确清空已识别调性不会从旧值复活 |
| 星级 | 0 / 51 / 102 / 153 / 204 / 255 与未评分 / 1–5 星互转，小数评分导出四舍五入并提示，原值不改 |
| Cue | POSITION_MARK，Memory Num=-1，Hot A–H Num=0–7；类型 0–4、Loop End、小数秒；未命名标记自动补显示名称 |
| 颜色 | 源 Red / Green / Blue 三项齐全时保留；不保证全部设备呈现一致 |
| BeatGrid | 来源 TEMPO 的起点 / BPM / 拍号 / 小节拍序保留。没有来源不生成；修改 AverageBpm 不拉伸或重算原拍点 |
| 附加资料 | 按白名单保存 Album、Composer 等原属性，不执行或解析文件链接；未知 XML 扩展不承诺保留 |
| 歌单 | 嵌套路径作为 Set 名称和导入识别标志，按 TrackID 或 Location 解析；重复曲目保持原顺序 |
| 导出 Set | 每套是一个平铺歌单；同名自动区分。Collection 中 TrackID 重建，所有引用同步重建；全库另有 All Tracks 歌单 |
| App 独有信息 | 能量、偏好、目标分钟、练习、Set 转场 / Cue In-Out / 重叠不写成曲目全局标记；用 JSON 或文本计划保留 |

## 重导、更新与保护

- 按规范本机文件 URI 匹配，不按同名歌猜测合并。相同标题但不同音频路径分别保留。
- 默认保留现有曲目元数据；勾选明确更新才替换 XML 字段 / Cue / BeatGrid，仍保留本地能量和内部 ID。
- 已导入同文件夹路径的歌单不覆盖本地编排；需要替换时先备份，再删除对应 Set 后重新导入。不同源库若恰有同路径歌单也会被保留策略拦下，可先重命名源歌单，不能宣称跨多个库的自动无歧义合并。
- 元数据更新若与现有 Set 播放段 / 重叠冲突，整批拒绝，不丢失现有编排。导入期间另有兴趣修改时拒绝旧预览覆盖。
- 文件夹结构不原样输出；波形、分析缓存、智能歌单规则、未知扩展及云端曲目不承诺无损。JSON 兴趣备份保存 App 内全部已支持字段，但不是整个 rekordbox 数据库备份。
- 音乐文件不上传，导入后的路径和备注属于共同家庭数据，对两位成员可见；财富顾问请求排除兴趣元数据。

## 容量与安全

XML ≤12MB / 20,000 原始曲目 / 有限层级，可从大库选一个歌单；真正导入后仍不超过 1,000 首、60 套 Set、每套 200 个出现位置、64 标记 / 曲、512 拍点段 / 曲，兴趣数据 ≤3MB。超限明确拒绝，不静默截断或删除旧数据。

只在浏览器用原生 XML 解析，不发送解析请求；拒绝 DTD / 外部实体、损坏 XML、重复 TrackID / 路径和坏引用。位置、Loop、Hot 槽位、数值及 URI 都经校验。导出对 XML 特殊字符及备注换行进行编码，不虚构文件路径或拍点。

## 验证边界

合成 XML 单元测试验证字段映射、往返、精度、曲序、重复曲目、未知值、路径和容量 / 安全拒绝。浏览器测试执行预览→确认→编辑→刷新→下载，并验证 320 / 768 / 1440px 布局及不改财富。真实云端测试仅用临时合成家庭，验证双成员保存路径 / Cue / Loop / BeatGrid，精确清理。

未在用户的真实 rekordbox 数据库或 DJ 硬件上试导，不以 XML 往返测试冒充设备认证。首次应在测试歌单试听核对，原生版本差异以实际软件为准。
