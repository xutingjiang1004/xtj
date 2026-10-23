# IP 属地中的行政区名称数据

`js/ip-city-data.js` 只提供地名、拼音／常见英文别名和行政区代码，用于规范化与省市一致性校验。它不是 IP 网段数据库，不能据此认定设备所在城市。

- 地名来源：`province-city-china@9.0.0`，上游提交 `0c4934fe9a160d6af3c4b3f295c8d23b2e806fb7`，MIT 许可见 [license](licenses/province-city-china-MIT.txt)。这是第三方版本化快照，不冒充实时官方行政区数据。
- 使用 333 条地级行政区，覆盖大陆 27 个省／自治区；省直辖占位项被排除。直辖市、港澳台省级名称继续由共用规则单独识别。本表没有县区／乡镇全集。
- 拼音由 `pinyin-pro@3.29.5` 离线生成，并补充 Lhasa、Hohhot、Ordos、Shigatse 等常见英文写法。转换器许可见 [license](licenses/pinyin-pro-MIT.txt)。运行时不加载转换器，不向新服务发送用户 IP。
- 同音别名必须结合省份区分；已知城市与省份／代码不符时不显示为可靠城市。表外地名和不受支持的外文写法仍可能无法规范化，不能把所有原始地名都宣称为已经通过行政区校验。

维护时将 npm 包 `province-city-china@9.0.0` 的 `dist/province.json`、`dist/city.json` 解压到独立临时目录，在独立工具目录安装固定版 `pinyin-pro@3.29.5`，再运行：

```bash
NODE_PATH=<工具目录>/node_modules node scripts/generate-ip-city-data.js <数据目录>
```

生成器核对两个源文件的 SHA-256 并拒绝版本漂移。更新源版本时，应同时审查行政区变化、变更固定摘要、更新许可说明，并执行城市、省市代码、浏览器和 Worker 回归；不要把历史 IP 的城市批量替换成当前登录地点。
