const path = require('path');
const loaderUtils = require('loader-utils');
const ejs = require('ejs');
const { marked, logger } = require('../../../utils');
const fs = require('fs');
const _ = require('lodash');
// const loaderUtils = require('loader-utils');
// const { parseMD, marked } = require('../utils');
const { parseMD, replaceExt } = require('../../../utils');
//TODO resolve selector
const selectorPath = require.resolve('../demo/selector');

const cwd = process.cwd();
const IMPORT_REG = /import {(.+)} from ['"]@alifd\/next['"];?/;
const IMPORT_LIB_REG = /import (.+) from ['"]@alifd\/next\/lib\/(.+)['"];?/;
const IMPORT_LIB_REG_G = /^import .+ from ['"]@alifd\/next\/lib\/(.+)['"];?/gm;

const tplsPath = path.resolve(__dirname, '../../tpls');
const headerTplPath = path.resolve(tplsPath, 'partials/header.ejs');
const indexTplPath = path.resolve(tplsPath, 'index.ejs');

module.exports = function(content) {
    const options = loaderUtils.getOptions(this);
    const demoPaths = options.demoPaths;
    const links = options.links;
    const lang = options.lang;
    const dir = options.dir;
    const resourcePath = this.resourcePath;

    this.addDependency(headerTplPath);
    this.addDependency(indexTplPath);
    this.addDependency(resourcePath);

    const lines = content.split(/\n/g);
    // const startIndex = lines.findIndex(line => /^-/.test(line));
    const endIndex = lines.findIndex(line => /^-{3,}/.test(line));
    const newContent = lines.slice(endIndex + 1).join('\n');
    const scripts = ['/common.js', `/${replaceExt(path.relative(cwd, this.resourcePath), '.js')}`];
    let [readmeFormer, readmeLatter] = newContent.split('## API');
    readmeFormer = marked(readmeFormer);
    readmeLatter = marked(`## API${readmeLatter}`);
    ejs.renderFile(
        indexTplPath,
        {
            scripts,
            links,
            lang,
            dir,
            name: 'index',
            readmeHTML: marked(newContent),
            readmeFormer,
            readmeLatter,
        },
        (err, html) => {
            if (err) {
                logger.error(`Render index.html failed: ${err}`);
            } else {
                const htmlPath = path.relative(
                    path.join(process.cwd(), 'docs'),
                    this.resourcePath.replace(/\.(en-us\.)?md$/, '.html')
                );
                this.emitFile(htmlPath, html);
            }
        }
    );

    // react-live
    const liveRelativePath = path.relative(path.dirname(resourcePath), path.resolve(__dirname, './react-live.js'));

    const importSet = [];
    const scrip = `
    import {LiveProvider, LiveEditor, LiveError, LivePreview} from '${liveRelativePath}';
    const playgroundDiv = document.createElement('div');
    playgroundDiv.id = 'next-demo-playground';
    playgroundDiv.className = 'markdown-body next-demo-playground';
    playgroundDiv.innerHTML = \`
        <h2 id="next-demo-playground">
            <a href='#next-demo-playground'>
                <span>代码演示</span>
            </a>
        </h2>\`;
    document.getElementById('demo-area').insertBefore(playgroundDiv, document.getElementById('md-area-latter'));
    ${
        getDemos(demoPaths, lang, dir, this.context, resourcePath)
            .split('\n')
            /* eslint-disable array-callback-return */
            .filter(line => {
                // TODO 引入/变量 去重
                if (importSet.includes(line)) return;
                if (/import/.test(line)) importSet.push(line);
                return line;
            })
            .join('\n')
        /* eslint-enable */
    }
    `;
    return scrip;
};

// TODO meta uncomplete
// TODO watch change
function getDemos(demoPaths, lang, dir, context, resourcePath) {
    const demoResults = {};
    const demoMetas = demoPaths.reduce((ret, demoPath) => {
        const content = fs.readFileSync(demoPath, 'utf8');
        const result = parseMD(content, demoPath, lang, dir);
        demoResults[demoPath] = result;
        ret[demoPath] = result.meta;
        return ret;
    }, {});
    const demoOrders = demoPaths.reduce((ret, demoPath) => {
        const meta = demoMetas[demoPath];
        let order = 9999;
        if (meta) {
            const number = parseInt(meta.order, 10);
            if (!isNaN(number)) {
                order = number;
            }
        }
        ret[demoPath] = order;
        return ret;
    }, {});
    const orderedDemoPaths = demoPaths.sort((prev, next) => demoOrders[prev] - demoOrders[next]);
    const demoInsertScript = orderedDemoPaths.reduce((ret, demoPath, index, array) => {
        const result = demoResults[demoPath];
        const formerDemoPath = index ? array[index - 1] : '';
        // console.log(`\n\n\n\n ${getLiveScript(result.js)}`);
        ret = `${ret}${result.css ? getCSSRequireString(path.resolve(demoPath), context) : ''}${processDemoJS(
            result.js,
            result.css,
            result.meta.desc,
            result.meta.title,
            result.body,
            demoPath,
            context,
            dir,
            formerDemoPath,
            resourcePath
        )}`;
        return ret;
    }, '');

    return demoInsertScript;
}

// TODO add react-axe
// TODO formerDemoPath delete
// TODO delete redundant import
// eslint-disable-next-line max-params
function processDemoJS(js, css, desc, title, body, demoPath, context, dir, formerDemoPath, resourcePath) {
    const ext = path.extname(demoPath);
    const name = _.camelCase(path.basename(demoPath, ext));
    const formerName = formerDemoPath ? path.basename(formerDemoPath, ext) : '';
    if (!js) {
        return '';
    }

    const liveArr = getLiveScript(js);
    const liveScript = liveArr[0];
    const liveVars = liveArr[1];

    js = fixImport(js, resourcePath, dir);

    // eslint-disable-next-line
    body = marked(body)
        .replace(/`/g, '{backquote}')
        .replace(/\$/g, '{dollar}');

    const importJs = js
        .split('\n')
        .filter(line => /import/.test(line))
        .join('\n');
    const noImportJs = js
        .split('\n')
        .filter(line => !/import/.test(line))
        .join('\n');
    const hotReloadCode = `

// HOT RELOAD CODE
const ${name}Container = document.createElement('div');
${name}Container.id = '${name}-container';
${name}Container.className = 'next-demo-item';
const ${name}Mount = document.createElement('div');
${name}Mount.id = '${name}-Mount';
${name}Mount.className = 'next-demo-mount';
const ${name}Desc = document.createElement('div');
${name}Desc.id = '${name}-desc';
${name}Desc.className = 'next-demo-desc';
${name}Desc.innerHTML = \`<h3><a href='#${name}-container'><span>${title}</span></a></h3><div>${desc}</div>\`;
const ${name}Body = document.createElement('div');
${name}Body.id = '${name}-body';
${name}Body.className = 'next-demo-body';
${name}Body.innerHTML = \`${body}\`.replace(/{backquote}/g, '\`').replace(/{dollar}/g, '$');

document.getElementById('demo-area').insertBefore(${name}Container, document.getElementById('md-area-latter'));
document.getElementById('${name}-container').appendChild(${name}Body);
document.getElementById('${name}-container').insertBefore(${name}Desc, document.getElementById('${name}-body'));
document.getElementById('${name}-container').insertBefore(${name}Mount, document.getElementById('${name}-desc'));
${importJs}
(function(){${noImportJs
        .replace(/(App|Demo)/g, name.toLowerCase().replace(/( |^)[a-z]/g, L => L.toUpperCase()))
        .replace('mountNode', `document.getElementById('${name}-Mount')`)}})()


    
// const ${name}LiveTest = document.createElement('div');
// ${name}LiveTest.id = '${name}-live-test';
// document.getElementById('demo-area').insertBefore(${name}LiveTest, document.getElementById('md-area-latter'));
// const ${name}LiveScript = '${liveScript.replace(/\n/g, '').replace(/'/g, '"')}';
// ReactDOM.render(
// <LiveProvider code={${name}LiveScript} scope={{${liveVars}}}>
//     <LiveEditor />
//     <LiveError />
//     <LivePreview />
// </LiveProvider>, document.getElementById('${name}-live-test'));

`;

    return hotReloadCode;
}

function getCSSRequireString(resourcePath, context) {
    const requestString = loaderUtils.stringifyRequest(
        context,
        `!!style-loader!css-loader!${selectorPath}!${resourcePath}`
    );
    return `require(${requestString})

`;
}

function fixImport(code, resourcePath) {
    const matched = code.match(IMPORT_REG);
    const matchedLib = code.match(IMPORT_LIB_REG_G);

    if (matched) {
        const components = matched[1].replace(/\s/g, '').split(',');

        const importStrings = components
            .map(component => {
                const componentPath = path.join(cwd, 'src', _.kebabCase(component));
                const relativePath = path.relative(path.dirname(resourcePath), componentPath);

                return `
import ${component} from '${relativePath}';
import '${path.join(relativePath, 'style.js')}';
`;
            })
            .join('\n');

        code = code.replace(IMPORT_REG, importStrings);
    }

    if (matchedLib) {
        matchedLib.forEach(element => {
            const component = element.match(IMPORT_LIB_REG)[1].replace(/\s/g, '');
            const afterLib = element.match(IMPORT_LIB_REG)[2].replace(/\s/g, '');
            const libPath = path.join(cwd, 'src', afterLib);
            const newLibPath = path.relative(path.dirname(resourcePath), libPath);
            const newLibStr = `
import ${component} from'${newLibPath}'`;

            code = code.replace(IMPORT_LIB_REG, newLibStr);
        });
    }

    return code;
}

function getLiveScript(code) {
    const vars = code
        .split('\n')
        /* eslint-disable array-callback-return */
        .map(line => {
            let variable = line.match(/(?<=import\s\{\s+).*(?=\s+\}\sfrom)/);
            if (variable) return variable[0];
            // variable = line.match(/const\s([.+]\=)/g);
            // if(variable) return [variable[0]];
            // variable = line.match(/(?<=const\s\{\s+).*(?=\s+\}\s\=)/g);
            // if(variable) return variable[0].split(', ');
        })
        /* eslint-enable */
        .join('');
    const varConst = code.split();
    let func = code
        .split('\n')
        .filter(line => !/import/.test(line))
        .join('\n');
    func = func
        .replace('ReactDOM.render', 'return')
        .replace(/,\n*\s*mountNode/g, '')
        .replace(/`/g, '\\`');

    return [`()=>{${func}}`, vars];
}
