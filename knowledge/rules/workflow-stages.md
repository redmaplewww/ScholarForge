# Workflow Stages — Simulink仿真

## Stage 1: 需求分析

- **Description**: 接收用户仿真需求，生成仿真规格文档(SSD)
- **Input**: 用户自然语言描述
- **Output**: SSD (Simulation Specification Document)
- **Review gate**: Yes (MC-101 ~ MC-120)
- **Agent**: requirement-analyst

## Stage 2: 仿真设计

- **Description**: 根据SSD设计仿真方案，生成仿真设计文档(SDD)
- **Input**: SSD
- **Output**: SDD (Simulation Design Document)
- **Review gate**: Yes (MC-201 ~ MC-220)
- **Agent**: simulink-designer

## Stage 3: 代码编写

- **Description**: 根据SDD生成可运行的MATLAB/Simulink代码(.slx, .m, .fis)
- **Input**: SDD
- **Output**: 完整代码文件集
- **Review gate**: Yes (MC-301 ~ MC-320)
- **Agent**: code-engineer

## Stage 4: 仿真运行

- **Description**: 执行仿真，监控收敛，诊断错误
- **Input**: 代码文件集
- **Output**: 仿真结果数据
- **Review gate**: Yes (MC-401 ~ MC-410)
- **Agent**: execution-agent

## Stage 5: 后处理分析

- **Description**: 数据可视化，性能指标计算，仿真报告
- **Input**: 仿真结果数据
- **Output**: 仿真分析报告
- **Review gate**: Yes (MC-501 ~ MC-510)
- **Agent**: postprocessor
