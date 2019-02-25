const markdown = require( `markdown-it` )
const hljs = require( `highlight.js` )
const { transform2RelativePath } = require( `../project-path` )
const { parse } = require( `../sfc-transform/template2Render` )
const { getYamlContent , yamlReg } = require( `../site-helper/readMeConfig` )
const yaml = require( `js-yaml` )
const mdHasNoVueCodeWarning = filePath => `<template>
                <div>
                    <code>${filePath}</code><br/>
                    未定义：<br/>
                    \`\`\`vue<br/>
                    // ...SFC code<br/>
                    \`\`\`<br/>
                </div>
            </template>` ,
    vueCodeReg = /(```\s*vue\s[\s\S]*?```)/ ,
    extractVueReg = /```\s*vue\s([\s\S]*)```/ ,
    extractVue = str => {
        let result = str.match( extractVueReg )
        if ( result ) {
            return result[ 1 ]
        } else {
            return undefined
        }
    }
// 用xml的解析规则高亮
hljs.registerLanguage( `vue` , require( `highlight.js/lib/languages/xml` ) )
const mdCommonClass = require( `../util/mdCommonClass` )

module.exports = function( source , map , meta ) {
    let callback = this.async() ,
        { resourcePath , context } = this ,
        metadata = { context , resourcePath } ,
        relativePath = transform2RelativePath( resourcePath ) ,
        mdFragments = source.split( vueCodeReg ) ,
        yamlStr = getYamlContent( source ) ,
        yamlConfig
    if ( yamlStr !== undefined ) {
        try {
            yamlConfig = yaml.safeLoad( yamlStr )
        } catch ( e ) {
            console.log( `文件：${relativePath},的yaml语法错误` , e )
        }
    }
    Object.assign( metadata , { yamlConfig } )
    let md = markdown( {
        html: true ,
        typographer: true ,
        highlight: function( str , lang ) {
            let className = `md-code-${lang}`
            if ( lang && hljs.getLanguage( lang ) ) {
                try {
                    let html = hljs.highlight( lang , str , true ).value
                    return `<codePanel><pre class="hljs ${className}" slot="content"><code>${html}</code></pre></codePanel>`
                } catch ( e ) {
                    callback( e )
                }
            }
            let html = md.utils.escapeHtml( str )
            return `<pre class="hljs ${className}"><code>${html}</code></pre>`
        } ,
    } )
    // 配置默认class - 先覆盖 ul table 相关
    // @TODO 抽取成独立插件全局处理
    md = mdCommonClass( md )

    let vueComponents = [] ,
        codeHtml ,
        dealFragments = mdFragments.map( ( mdStr , index ) => {
            // yaml配置不展示
            mdStr = mdStr.replace( yamlReg , `` )
            let isVueCode = vueCodeReg.test( mdStr ) ,
                mdHtml = md.render( mdStr )
            // 解决md中的`{{`,`}}`符号被sfc当做template插值语法来解析
            mdHtml = mdHtml
                .replace( `{{` , `<span>{{</span>` )
                .replace( `}}` , `<span>}}</span>` )

            if ( isVueCode ) {
                let content = extractVue( mdStr ) ,
                    name = `Demo${index}Component` ,
                    vueComponent = {
                        name ,
                        content ,
                    }
                codeHtml = [ mdHtml ]
                vueComponents.push( vueComponent )
                return [
                    `<div class="md-live-vue">
                        <${name} />
                    </div>` ,
                ]
            }
            return [ `<div class="demo-info">${mdHtml}</div>` ]
        } )
    dealFragments.push( codeHtml )
    let html2 = [].concat( ...dealFragments ).join( `` )
    const tokens = md.parse( source ) ,
        vueModule = tokens.find(
            ( { type , tag , info } ) =>
                type === `fence` && tag === `code` && info === `vue` ,
        ) ,
        hasVueModule = vueModule !== undefined
    if ( hasVueModule ) {
        let componentToPromise = vueComponents.map(
            async ( { name , content } ) => {
                let vueDemoModule = await parse( content , name , metadata )
                return vueDemoModule
            } ,
        )
        Promise.all( componentToPromise )
            .then( es6Modules => {
                let jsStrArr = [] ,
                    cssTxtArr = [] ,
                    componentArr = []
                es6Modules.forEach( ( { name , codeTxt , cssTxt } ) => {
                    componentArr.push( name )
                    jsStrArr.push( codeTxt )
                    cssTxtArr.push( cssTxt )
                } )

                let components = componentArr.join( `,` ) ,
                    jsStr = jsStrArr.join( `;\n` ) ,
                    cssTxt = cssTxtArr.join( `\n` ) ,
                    vueModuleStr = `
                        <template>
                            <div class="md-live-vue-with-md">
                                 <div class="markdown">${html2}</div>
                            </div>
                        </template>
                        <script>
                            // md中vue组件 source code
                            ${jsStr}
                            import codePanel from 'site/components/codePanel'
                            // 注册md中的vue组件
                            export default {
                                __yamlConfig: ${
    yamlConfig
        ? JSON.stringify( yamlConfig )
        : `undefined`
} ,
                                components: { ${components} , codePanel }
                            }
                        </script>
                        <style>
                            ${cssTxt}
                        </style>
                    `
                callback( null , vueModuleStr , map , meta )
            } )
            .catch( callback )
    } else {
        callback( null , mdHasNoVueCodeWarning( relativePath ) , map , meta )
    }
}
