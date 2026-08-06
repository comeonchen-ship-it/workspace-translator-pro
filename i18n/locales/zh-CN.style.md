# 简体中文（zh-CN）翻译风格指南

- **人称**：敬语用「请」，尽量省略主语，不用「您」堆砌。
- **用字**：大陆用语 —— 程序、文件（=file）、文件夹、默认、演示文稿、电子表格。
- **标点**：中文句用全角 `。，、；：？！（）「」`；省略号用 `…`；引号用「」。
- **不翻译**：Google / Gemini / OpenAI / Claude / API / LLM / RPD / RPM，及模型名、网址。
- **占位符**：`{fileType} {engine} {count} {position} {status} {error} {model} {url} {suffix}` 原样保留。
- **参数嵌套**：`{fileType}` 由 `fileType.*` 翻译后代入，故 `steps.copy`＝「复制原始{fileType}」。
