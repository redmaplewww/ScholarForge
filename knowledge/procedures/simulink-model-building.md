---
id: KB-procedure-simulink-model-building
type: procedure
tags: [Simulink, 建模, 流程, MATLAB脚本]
source: 案例提取 - 最佳实践
created: 2026-04-30
---

# Simulink模型构建流程

## 1. 参数初始化 (params.m)

```matlab
% 电机参数
Rs = 2.875;        % 定子电阻 [Ω]
Ld = 0.0085;       % d轴电感 [H]
Lq = 0.0085;       % q轴电感 [H]
psi_f = 0.175;     % 永磁体磁链 [Wb]
pn = 4;            % 极对数
J = 0.0008;        % 转动惯量 [kg·m²]

% 控制参数
fsw = 10000;        % 开关频率 [Hz]
Ts = 1/fsw;         % 开关周期 [s]

% 仿真参数
Tsim = 0.5;         % 仿真时长 [s]
solver = 'ode15s';  % Solver类型
maxStep = 1e-5;     % 最大步长 [s]
```

## 2. 模型创建 (build_model.m)

```matlab
model_name = 'pmsm_foc';
new_system(model_name);
open_system(model_name);

% 添加模块
add_block('simulink/Simscape/Electrical/Specialized Power Systems/Fundamental Blocks/Elements/Machine', ...
    [model_name '/PMSM']);

% 设置参数
set_param([model_name '/PMSM'], 'Rs', num2str(Rs), ...
    'Ld', num2str(Ld), 'Lq', num2str(Lq));

% 连接信号线
add_line(model_name, 'Controller/1', 'PMSM/1');

save_system(model_name);
```

## 3. Fuzzy-PID加载

```matlab
fis = readfis('fuzzypid.fis');
```

## 4. 运行仿真

```matlab
sim(model_name, Tsim);
```

## 注意事项

- 所有参数从params.m加载，不要硬编码
- 模型文件(.slx)由脚本生成，可版本控制
- 使用相对路径引用同目录下的.fis文件
